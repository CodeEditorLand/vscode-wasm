/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
/// <reference path="../../typings/webAssemblyCommon.d.ts" />
import RAL from './ral';

import uuid from 'uuid';

import { Memory as _Memory, Alignment, ComponentModelContext, GenericComponentModelType, ResourceManagers, ptr, u32, size, JType } from '@vscode/wasm-component-model';

export interface Memory extends _Memory {
	id: string;
	free(ptr: ptr): void;
	isSame(memory: Memory): boolean;
	getTransferable(): Memory.Transferable;
}

export namespace Memory {

	export function is(value: any): value is Memory {
		return value instanceof MemoryImpl;
	}

	export function create(): Promise<Memory> {
		return RAL().Memory.create(MemoryImpl);
	}

	export function createFrom(transferable: Memory.Transferable): Promise<Memory> {
		return RAL().Memory.createFrom(MemoryImpl, transferable);
	}

	export type Transferable = {
		id: string;
		module: WebAssembly.Module;
		memory: WebAssembly.Memory;
	};
	export interface Exports {
		malloc(size: number): number;
		free(ptr: number): void;
		aligned_alloc(align: number, size: number): number;
	}
}

class MemoryImpl implements _Memory {

	public readonly id: string;
	private readonly module: WebAssembly.Module;
	private readonly memory: WebAssembly.Memory;
	private readonly exports: Memory.Exports;

	private _raw: Uint8Array | undefined;
	private _view: DataView | undefined;

	public constructor(module: WebAssembly.Module, memory: WebAssembly.Memory, exports: Memory.Exports, id?: string) {
		this.id = id ?? uuid.v4();
		this.module = module;
		this.memory = memory;
		this.exports = exports;
	}

	public isSame(memory: Memory): boolean {
		return this.buffer === memory.buffer;
	}

	public getTransferable(): Memory.Transferable {
		return { id: this.id, module: this.module, memory: this.memory };
	}

	public get buffer(): ArrayBuffer {
		return this.memory.buffer;
	}

	public get raw(): Uint8Array {
		if (this._raw === undefined || this._raw.buffer !== this.memory.buffer) {
			this._raw = new Uint8Array(this.memory.buffer);
		}
		return this._raw;
	}

	public get view(): DataView {
		if (this._view === undefined || this._view.buffer !== this.memory.buffer) {
			this._view = new DataView(this.memory.buffer);
		}
		return this._view;
	}

	public alloc(align: Alignment, size: size): ptr {
		try {
			const ptr = this.exports.aligned_alloc(align, size);
			if (ptr === 0) {
				throw new Error('Allocation failed');
			}
			return ptr;
		} catch (error) {
			RAL().console.error(`Alloc [${align}, ${size}] failed. Buffer size: ${this.memory.buffer.byteLength}`);
			throw error;
		}
	}

	public realloc(_ptr: ptr, _oldSize: size, _align: Alignment, _newSize: size): ptr {
		throw new Error('Not implemented');
	}

	public free(ptr: ptr): void {
		try {
			this.exports.free(ptr);
		} catch (error) {
			RAL().console.error(`Free ptr ${ptr} failed. Buffer size: ${this.memory.buffer.byteLength}`);
			throw error;
		}
	}
}

export class MemoryLocation {

	private readonly _memory: Memory;
	private _ptr: ptr;

	constructor(memory: Memory, ptr: ptr) {
		this._memory = memory;
		this._ptr = ptr;
	}

	public get memory(): Memory {
		return this._memory;
	}

	public get ptr(): ptr {
		if (this._ptr === -1) {
			throw new Error('MemoryLocation has been freed');
		}
		return this._ptr;
	}

	public free(): void {
		this._memory.free(this._ptr);
		this._ptr = -1;
	}

	public getTransferable(): MemoryLocation.Transferable {
		return { memory: this._memory.getTransferable(), ptr: this._ptr };
	}

	public getSurrogate(): MemoryLocation.Surrogate {
		return { memory: { id: this._memory.id }, ptr: this._ptr };
	}

	public getInt32Array(offset: number, length: number): Int32Array {
		return new Int32Array(this._memory.buffer, this._ptr + offset, length);
	}
}
export namespace MemoryLocation {
	export type Transferable = {
		memory: Memory.Transferable;
		ptr: ptr;
	};
	export type Surrogate = {
		memory: { id: string };
		ptr: ptr;
	};
}

export class Allocation {

	private readonly memory: Memory;
	private readonly align: Alignment;
	private readonly size: size;

	constructor(memory: Memory, align: Alignment, size: size) {
		this.memory = memory;
		this.align = align;
		this.size = size;
	}

	public alloc(): MemoryLocation {
		const ptr = this.memory.alloc(this.align, this.size);
		return new MemoryLocation(this.memory, ptr);
	}
}

export class Lock {

	private readonly buffer: Int32Array;
	private lockCount: number;

	constructor(buffer: Int32Array) {
		this.buffer = buffer;
		this.lockCount = 0;
	}

	public acquire(): void {
		// We already have a lock.
		if (this.lockCount > 0) {
			this.lockCount++;
			return;
		}
		while (true) {
			const value = Atomics.load(this.buffer, 0);
			if (value > 0 && Atomics.compareExchange(this.buffer, 0, value, value - 1) === value) {
				this.lockCount = 1;
				return;
			}
			Atomics.wait(this.buffer, 0, value);
		}
	}

	public release(): void {
		if (this.lockCount > 1) {
			this.lockCount--;
			return;
		}
		Atomics.add(this.buffer, 0, 1);
		Atomics.notify(this.buffer, 0, 1);
		this.lockCount = 0;
	}

}

export abstract class SharedObject {

	public static Context: ComponentModelContext = {
		options: { encoding: 'utf-8' },
		managers: ResourceManagers.createDefault()
	};

	protected readonly location: MemoryLocation;
	private readonly allocated: boolean;

	protected constructor(allocationOrLocation: Allocation | MemoryLocation) {
		if (allocationOrLocation instanceof MemoryLocation) {
			this.location = allocationOrLocation;
			this.allocated = false;
		} else if (allocationOrLocation instanceof Allocation) {
			this.location = allocationOrLocation.alloc();
			this.allocated = true;
		} else {
			throw new Error('Invalid argument');
		}
	}

	public dispose(): void {
		if (!this.allocated) {
			// We should think about a trace when we dispose
			// a shared object from a thread that hasn't allocated it.
		}
		this.location.free();
	}

	protected memory(): Memory {
		return this.location.memory;
	}
}

export type Properties = [string, GenericComponentModelType][];
type RecordProperties = { [key: string]: JType };
export type RecordInfo<T extends RecordProperties> = { [key in keyof T]: { offset: number; type: GenericComponentModelType } };

export class RecordDescriptor<T extends RecordProperties> {
	public readonly alignment: Alignment;
	public readonly size: size;
	private readonly _fields: Map<string, { type: GenericComponentModelType; offset: number }>;
	public readonly fields: RecordInfo<T>;

	constructor(properties: Properties) {
		let alignment: Alignment = Alignment.byte;
		let size = 0;
		const fields = Object.create(null);
		const fieldsMap: Map<string, { type: GenericComponentModelType; offset: number }> = new Map();
		for (const [name, type] of properties) {
			if (fieldsMap.has(name)) {
				throw new Error(`Duplicate property ${name}`);
			}
			alignment = Math.max(alignment, type.alignment);
			size = Alignment.align(size, type.alignment);
			const info = { offset: size, type };
			fieldsMap.set(name, info);
			fields[name] = info;
			size = size + type.size;
		}
		this.alignment = alignment;
		this.size = size;
		this.fields = fields;
		this._fields = fieldsMap;
	}

	getField(name: string): { type: GenericComponentModelType; offset: number } | undefined {
		return this._fields.get(name);
	}

	hasField(name: string): boolean {
		return this._fields.has(name);
	}

	createAccess(location: MemoryLocation): T {
		const memory = location.memory;
		const ptr = location.ptr;
		const access = Object.create(null);
		for (const [name, { type, offset }] of this._fields) {
			if (name.startsWith('_')) {
				continue;
			}
			Object.defineProperty(access, name, {
				get() {
					return type.load(memory, ptr + offset, SharedObject.Context);
				},
				set(value) {
					type.store(memory, ptr + offset, value, SharedObject.Context);
				}
			});
		}
		return access as T;
	}
}

export abstract class SharedRecord<T extends RecordProperties> extends SharedObject {

	protected readonly access: T;

	constructor(recordInfo: RecordDescriptor<T>, location: MemoryLocation | Memory) {
		if (location instanceof MemoryLocation) {
			super(location);
		} else {
			super(new Allocation(location, recordInfo.alignment, recordInfo.size));
		}
		this.access = recordInfo.createAccess(this.location);
	}

	protected abstract getRecordInfo(): RecordDescriptor<T>;
}

export abstract class LockableRecord<T extends RecordProperties> extends SharedRecord<T> {

	protected static createRecordInfo<T extends RecordProperties>(properties: Properties): RecordDescriptor<T> {
		let hasLock = false;
		for (const [name, ] of properties) {
			if (name === '_lock') {
				hasLock = true;
				break;
			}
		}
		if (!hasLock) {
			properties = properties.slice();
			properties.push(['_lock', u32]);
		}
		return new RecordDescriptor(properties);
	}

	private readonly lock: Lock;

	protected constructor(recordInfo: RecordDescriptor<T>, location: MemoryLocation | Memory, lock?: Lock) {
		if (!recordInfo.hasField('_lock')) {
			throw new Error('RecordInfo does not contain a lock field');
		}
		super(recordInfo, location);
		if (lock === undefined) {
			const offset = recordInfo.getField('_lock')!.offset;
			const lockBuffer = this.location.getInt32Array(offset, 1);
			// We allocated the memory for this shared record so we need to initialize
			// the lock count to 1. If we use an existing memory location, we need to
			// leave the lock count untouched since the shared record could be locked in
			// another thread.
			if (location === undefined) {
				Atomics.store(lockBuffer, 0, 1);
			}
			this.lock = new Lock(lockBuffer);
		} else {
			this.lock = lock;
		}
	}

	public runLocked(callback: (value: this) => void): void {
		this.acquireLock();
		try {
			callback(this);
		} finally {
			this.releaseLock();
		}
	}

	protected acquireLock(): void {
		this.lock.acquire();
	}

	protected releaseLock(): void {
		this.lock.release();
	}
}