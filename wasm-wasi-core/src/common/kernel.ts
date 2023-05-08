/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Uri, WorkspaceFoldersChangeEvent, extensions, workspace } from 'vscode';

import RAL from './ral';
import { ExtensionLocationDescriptor, InMemoryFileSystemDescriptor, VSCodeFileSystemDescriptor, MapDirDescriptor, ExtensionContributionDescriptor } from './api';
import type { DeviceDriver, DeviceId, FileSystemDeviceDriver } from './deviceDriver';
import { Errno, WasiError } from './wasi';
import * as ConsoleDriver from './consoleDriver';
import * as vscfs from './vscodeFileSystemDriver';
import * as extlocfs from './extLocFileSystem';
import * as memfs from './memoryFileSystem';

type ExtensionDataFileSystem = {
	id: string;
	kind: 'extensionData';
	path: string;
	mountPoint: string;
};
namespace ExtensionDataFileSystem {
	export function is(value: any): value is Omit<ExtensionDataFileSystem, 'extension'> {
		const candidate = value as ExtensionDataFileSystem;
		return candidate && candidate.kind === 'extensionData' && typeof candidate.id === 'string' && typeof candidate.path === 'string' && typeof candidate.mountPoint === 'string';
	}
}

type FileSystem = ExtensionDataFileSystem;

namespace FileSystem {
	export function is(value: any): value is FileSystem {
		return ExtensionDataFileSystem.is(value);
	}
}

function getSegments(path: string): string[] {
	if (path.charAt(0) === '/') { path = path.substring(1); }
	if (path.charAt(path.length - 1) === '/') { path = path.substring(0, path.length - 1); }
	return path.normalize().split('/');
}

namespace MapDirDescriptors {
	export function isExtensionLocation(descriptor: MapDirDescriptor): descriptor is ExtensionLocationDescriptor {
		return descriptor.kind === 'extensionLocation';
	}
	export function isExtensionContribution(descriptor: MapDirDescriptor): descriptor is ExtensionContributionDescriptor {
		return descriptor.kind === 'extensionContribution';
	}
	export function isInMemoryDescriptor(descriptor: MapDirDescriptor): descriptor is InMemoryFileSystemDescriptor {
		return descriptor.kind === 'inMemoryFileSystem';
	}
	export function isVSCodeFileSystemDescriptor(descriptor: MapDirDescriptor): descriptor is VSCodeFileSystemDescriptor {
		return descriptor.kind === 'vscodeFileSystem';
	}
	export function key(descriptor: VSCodeFileSystemDescriptor | ExtensionLocationDescriptor | InMemoryFileSystemDescriptor): Uri {
		switch (descriptor.kind) {
			case 'extensionLocation':
				return Uri.joinPath(descriptor.extension.extensionUri, ...getSegments(descriptor.path));
			case 'inMemoryFileSystem':
				return descriptor.fileSystem.uri;
			case 'vscodeFileSystem':
				return descriptor.uri;
			default:
				throw new Error(`Unknown MapDirDescriptor kind ${JSON.stringify(descriptor, undefined, 0)}`);
		}
	}
}

export enum ManageKind {
	no = 1,
	yes = 2,
	default = 3
}

class FileSystems {

	private readonly contributionIdToUri: Map<string, Uri>;
	private contributedFileSystems: Map<string, MapDirDescriptor>;
	private readonly fileSystemDeviceDrivers: Map<string, FileSystemDeviceDriver>;

	constructor() {
		this.contributionIdToUri = new Map();
		this.contributedFileSystems = new Map();
		this.fileSystemDeviceDrivers = new Map();

		// Handle workspace folders
		this.parseWorkspaceFolders();
		workspace.onDidChangeWorkspaceFolders(event => this.handleWorkspaceFoldersChanged(event));

		const fileSystems = this.parseFileSystems();
		for (const fileSystem of fileSystems) {
			this.contributedFileSystems.set(fileSystem.id.toString(), fileSystem.mapDir);
			this.contributionIdToUri.set(fileSystem.contributionId, fileSystem.id);
		}
		extensions.onDidChange(() => this.handleExtensionsChanged());
	}

	public async getFileSystem(uri: Uri): Promise<FileSystemDeviceDriver | undefined> {
		const key = uri.toString();
		let result = this.fileSystemDeviceDrivers.get(key);
		if (result !== undefined) {
			return result;
		}
		const mapDir = this.contributedFileSystems.get(key);
		if (mapDir !== undefined) {
			if (mapDir.kind === 'extensionLocation') {
				try {
					const result = await this.createExtensionLocationFileSystem(mapDir);
					this.fileSystemDeviceDrivers.set(key, result);
				} catch (error) {
					return undefined;
				}
			}
		}
		return undefined;
	}

	getExtensionLocationDescriptor(descriptor: ExtensionContributionDescriptor): ExtensionLocationDescriptor | undefined {
		const uri = this.contributionIdToUri.get(descriptor.id);
		if (uri === undefined) {
			return undefined;
		}
		return this.contributedFileSystems.get(uri.toString()) as ExtensionLocationDescriptor;
	}

	public async getOrCreateFileSystemByDescriptor(deviceDrivers: DeviceDrivers, descriptor: VSCodeFileSystemDescriptor | ExtensionLocationDescriptor | InMemoryFileSystemDescriptor, manage: ManageKind = ManageKind.default): Promise<FileSystemDeviceDriver> {
		const key = MapDirDescriptors.key(descriptor);
		if (deviceDrivers.hasByUri(key)) {
			return deviceDrivers.getByUri(key) as FileSystemDeviceDriver;
		}
		let result = this.fileSystemDeviceDrivers.get(key.toString());
		if (result !== undefined) {
			deviceDrivers.add(result);
			return result;
		}
		if (MapDirDescriptors.isExtensionLocation(descriptor)) {
			result = await this.createExtensionLocationFileSystem(descriptor);
			if (manage === ManageKind.default) {
				manage = ManageKind.yes;
			}
		} else if (MapDirDescriptors.isInMemoryDescriptor(descriptor)) {
			result = memfs.create(WasiKernel.nextDeviceId(), descriptor.fileSystem as memfs.MemoryFileSystem);
			if (manage === ManageKind.default) {
				manage = ManageKind.no;
			}
		} else if (MapDirDescriptors.isVSCodeFileSystemDescriptor(descriptor)) {
			result = vscfs.create(WasiKernel.nextDeviceId(), descriptor.uri, !(workspace.fs.isWritableFileSystem(descriptor.uri.scheme) ?? true));
			if (manage === ManageKind.default) {
				manage = ManageKind.yes;
			}
		}
		if (result !== undefined && manage === ManageKind.yes) {
			this.fileSystemDeviceDrivers.set(key.toString(), result);
		}
		if (result === undefined) {
			throw new Error(`Unable to create file system for ${JSON.stringify(descriptor, undefined, 0)}`);
		}
		deviceDrivers.add(result);
		return result;
	}

	private parseFileSystems(): { id: Uri; contributionId: string; mapDir: MapDirDescriptor }[] {
		const result: { id: Uri; contributionId: string; mapDir: MapDirDescriptor }[] = [];
		for (const extension of extensions.all) {
			const packageJSON = extension.packageJSON;
			const fileSystems: FileSystem[] = packageJSON?.contributes?.wasm?.fileSystems;
			if (fileSystems !== undefined) {
				for (const contribution of fileSystems) {
					if (ExtensionDataFileSystem.is(contribution)) {
						const mapDir: ExtensionLocationDescriptor = {
							kind: 'extensionLocation',
							extension: extension,
							path: contribution.path,
							mountPoint: contribution.mountPoint
						};
						const id = Uri.joinPath(extension.extensionUri, ...getSegments(contribution.path));
						result.push({ id, contributionId: contribution.id, mapDir });
					}
				}
			}
		}
		return result;
	}

	private handleExtensionsChanged(): void {
		const oldFileSystems: Map<string, MapDirDescriptor> = new Map(this.contributedFileSystems.entries());
		const newFileSystems: Map<string, MapDirDescriptor> = new Map(this.parseFileSystems().map(fileSystem => [fileSystem.id.toString(), fileSystem.mapDir]));
		const added: Map<string, MapDirDescriptor> = new Map();
		for (const [id, newFileSystem] of newFileSystems) {
			if (oldFileSystems.has(id)) {
				oldFileSystems.delete(id);
			} else {
				added.set(id, newFileSystem);
			}
		}
		for (const [id, add] of added) {
			this.contributedFileSystems.set(id, add);
		}
		for (const id of oldFileSystems.keys()) {
			this.contributedFileSystems.delete(id);
			this.fileSystemDeviceDrivers.delete(id);
		}
	}

	private parseWorkspaceFolders(): void {
		const folders = workspace.workspaceFolders;
		if (folders !== undefined) {
			for (const folder of folders) {
				const key = folder.uri.toString();
				if (!this.fileSystemDeviceDrivers.has(key)) {
					const driver = vscfs.create(WasiKernel.nextDeviceId(), folder.uri, !(workspace.fs.isWritableFileSystem(folder.uri.scheme) ?? true));
					this.fileSystemDeviceDrivers.set(key, driver);
				}
			}
		}
	}

	private handleWorkspaceFoldersChanged(event: WorkspaceFoldersChangeEvent): void {
		for (const added of event.added) {
			const key = added.uri.toString();
			if (!this.fileSystemDeviceDrivers.has(key)) {
				const driver = vscfs.create(WasiKernel.nextDeviceId(), added.uri, !(workspace.fs.isWritableFileSystem(added.uri.scheme) ?? true));
				this.fileSystemDeviceDrivers.set(key, driver);
			}
		}
		for (const removed of event.removed) {
			const key = removed.uri.toString();
			this.fileSystemDeviceDrivers.delete(key);
		}
	}

	private async createExtensionLocationFileSystem(descriptor: ExtensionLocationDescriptor): Promise<FileSystemDeviceDriver> {
		let extensionUri = descriptor.extension.extensionUri;
		extensionUri = extensionUri.with({ path: RAL().path.join(extensionUri.path, descriptor.path) });

		const paths = RAL().path;
		const basename = paths.basename(descriptor.path);
		const dirname = paths.dirname(descriptor.path);
		const dirDumpFileUri = Uri.joinPath(descriptor.extension.extensionUri, dirname, `${basename}.dir.json`);
		try {
			const content = await workspace.fs.readFile(dirDumpFileUri);
			const dirDump = JSON.parse(RAL().TextDecoder.create().decode(content));
			const extensionFS = extlocfs.create(WasiKernel.nextDeviceId(), extensionUri, dirDump);
			return extensionFS;
		} catch (error) {
			RAL().console.error(`Failed to read directory dump file ${dirDumpFileUri.toString()}: ${error}`);
			throw error;
		}
	}
}

export interface DeviceDrivers {
	add(driver: DeviceDriver): void;
	has (id: DeviceId): boolean;
	hasByUri(uri: Uri): boolean;
	get(id: DeviceId): DeviceDriver;
	getByUri(uri: Uri): DeviceDriver;
	remove(id: DeviceId): void;
	removeByUri(uri: Uri): void;
	size: number;
	values(): IterableIterator<DeviceDriver>;
	entries(): IterableIterator<[bigint, DeviceDriver]>;
	[Symbol.iterator](): IterableIterator<[bigint, DeviceDriver]>;
}

class DeviceDriversImpl {

	private readonly devices: Map<DeviceId, DeviceDriver>;
	private readonly devicesByUri: Map<string, DeviceDriver>;

	public constructor() {
		this.devices = new Map();
		this.devicesByUri = new Map();
	}

	public add(driver: DeviceDriver): void {
		this.devices.set(driver.id, driver);
		this.devicesByUri.set(driver.uri.toString(true), driver);
	}

	public has (id: DeviceId): boolean {
		return this.devices.has(id);
	}

	public hasByUri(uri: Uri): boolean {
		return this.devicesByUri.has(uri.toString(true));
	}

	public get(id: DeviceId): DeviceDriver {
		const driver = this.devices.get(id);
		if (driver === undefined) {
			throw new WasiError(Errno.nxio);
		}
		return driver;
	}

	public getByUri(uri: Uri): DeviceDriver {
		const driver = this.devicesByUri.get(uri.toString(true));
		if (driver === undefined) {
			throw new WasiError(Errno.nxio);
		}
		return driver;
	}

	public remove(id: DeviceId): void {
		const driver = this.devices.get(id);
		if (driver === undefined) {
			throw new WasiError(Errno.nxio);
		}
		this.devices.delete(id);
		this.devicesByUri.delete(driver.uri.toString(true));
	}

	public removeByUri(uri: Uri): void {
		const key = uri.toString(true);
		const driver = this.devicesByUri.get(key);
		if (driver === undefined) {
			throw new WasiError(Errno.nxio);
		}
		this.devices.delete(driver.id);
		this.devicesByUri.delete(key);
	}

	public get size(): number {
		return this.devices.size;
	}

	public values(): IterableIterator<DeviceDriver> {
		return this.devices.values();
	}

	public entries(): IterableIterator<[bigint, DeviceDriver]> {
		return this.devices.entries();
	}

	public [Symbol.iterator](): IterableIterator<[bigint, DeviceDriver]> {
		return this.entries();
	}
}

class LocalDeviceDrivers implements DeviceDrivers {

	private readonly nextDrivers: DeviceDrivers;
	private readonly devices: Map<DeviceId, DeviceDriver>;
	private readonly devicesByUri: Map<string, DeviceDriver>;

	public constructor(next: DeviceDrivers) {
		this.nextDrivers = next;
		this.devices = new Map();
		this.devicesByUri = new Map();
	}

	public add(driver: DeviceDriver): void {
		this.devices.set(driver.id, driver);
		this.devicesByUri.set(driver.uri.toString(true), driver);
	}

	public has(id: bigint): boolean {
		if (this.nextDrivers.has(id)) {
			return true;
		}
		return this.devices.has(id);
	}

	public hasByUri(uri: Uri): boolean {
		if (this.nextDrivers.hasByUri(uri)) {
			return true;
		}
		return this.devicesByUri.has(uri.toString(true));
	}

	public get(id: bigint): DeviceDriver {
		const result = this.devices.get(id);
		if (result !== undefined) {
			return result;
		}
		return this.nextDrivers.get(id);
	}

	public getByUri(uri: Uri): DeviceDriver {
		const result = this.devicesByUri.get(uri.toString(true));
		if (result !== undefined) {
			return result;
		}
		return this.nextDrivers.getByUri(uri);
	}

	public remove(id: bigint): void {
		const driver = this.devices.get(id);
		if (driver !== undefined) {
			this.devices.delete(id);
			this.devicesByUri.delete(driver.uri.toString(true));
			return;
		}
		this.nextDrivers.remove(id);
	}

	public removeByUri(uri: Uri): void {
		const key = uri.toString(true);
		const driver = this.devicesByUri.get(key);
		if (driver !== undefined) {
			this.devices.delete(driver.id);
			this.devicesByUri.delete(key);
			return;
		}
		this.nextDrivers.removeByUri(uri);
	}

	public get size(): number {
		return this.devices.size + this.nextDrivers.size;
	}

	public entries(): IterableIterator<[bigint, DeviceDriver]> {
		let local: IterableIterator<[bigint, DeviceDriver]> | undefined = this.devices.entries();
		const next = this.nextDrivers.entries();
		const iterator: IterableIterator<[bigint, DeviceDriver]> = {
			[Symbol.iterator]: () => {
				return iterator;
			},
			next: (): IteratorResult<[bigint, DeviceDriver]> => {
				if (local !== undefined) {
					const result = local.next();
					if (!result.done) {
						return result;
					}
					local = undefined;
				}
				return next.next();
			}
		};
		return iterator;
	}

	public values(): IterableIterator<DeviceDriver> {
		let local: IterableIterator<DeviceDriver> | undefined = this.devices.values();
		const next = this.nextDrivers.values();
		const iterator: IterableIterator<DeviceDriver> = {
			[Symbol.iterator]: () => {
				return iterator;
			},
			next: (): IteratorResult<DeviceDriver> => {
				if (local !== undefined) {
					const result = local.next();
					if (!result.done) {
						return result;
					}
					local = undefined;
				}
				return next.next();
			}
		};
		return iterator;
	}

	public [Symbol.iterator](): IterableIterator<[bigint, DeviceDriver]> {
		return this.entries();
	}
}

namespace WasiKernel {
	let deviceCounter: DeviceId = 1n;
	export function nextDeviceId(): bigint {
		return deviceCounter++;
	}

	const fileSystems = new FileSystems();
	export function getExtensionLocationDescriptor(descriptor: ExtensionContributionDescriptor): ExtensionLocationDescriptor | undefined {
		return fileSystems.getExtensionLocationDescriptor(descriptor);
	}
	export function getOrCreateFileSystemByDescriptor(deviceDrivers: DeviceDrivers, descriptor: VSCodeFileSystemDescriptor | ExtensionLocationDescriptor | InMemoryFileSystemDescriptor): Promise<FileSystemDeviceDriver> {
		return fileSystems.getOrCreateFileSystemByDescriptor(deviceDrivers, descriptor);
	}

	export const deviceDrivers = new DeviceDriversImpl();
	// By default we have a console
	export const console = ConsoleDriver.create(nextDeviceId());
	deviceDrivers.add(console);
	export function createLocalDeviceDrivers(): DeviceDrivers {
		return new LocalDeviceDrivers(deviceDrivers);
	}
}

export default WasiKernel;