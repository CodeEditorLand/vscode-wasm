/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as $wcm from '@vscode/wasm-component-model';
import type { u64, u32, s32, i64, i32, ptr } from '@vscode/wasm-component-model';
import { io } from './io';

export namespace clocks {
	/**
	 * WASI Monotonic Clock is a clock API intended to let users measure elapsed
	 * time.
	 * 
	 * It is intended to be portable at least between Unix-family platforms and
	 * Windows.
	 * 
	 * A monotonic clock is a clock which has an unspecified initial value, and
	 * successive reads of the clock will produce non-decreasing values.
	 * 
	 * It is intended for measuring elapsed time.
	 */
	export namespace MonotonicClock {
		
		export type Pollable = io.Poll.Pollable;
		
		/**
		 * A timestamp in nanoseconds.
		 */
		export type Instant = u64;
		
		/**
		 * Read the current value of the clock.
		 * 
		 * The clock is monotonic, therefore calling this function repeatedly will
		 * produce a sequence of non-decreasing values.
		 */
		export declare function now(): Instant;
		
		/**
		 * Query the resolution of the clock.
		 */
		export declare function resolution(): Instant;
		
		/**
		 * Create a `pollable` which will resolve once the specified time has been
		 * reached.
		 */
		export declare function subscribe(when: Instant, absolute: boolean): Pollable;
	}
	export type MonotonicClock = Pick<typeof MonotonicClock, 'now' | 'resolution' | 'subscribe'>;
	
	/**
	 * WASI Wall Clock is a clock API intended to let users query the current
	 * time. The name "wall" makes an analogy to a "clock on the wall", which
	 * is not necessarily monotonic as it may be reset.
	 * 
	 * It is intended to be portable at least between Unix-family platforms and
	 * Windows.
	 * 
	 * A wall clock is a clock which measures the date and time according to
	 * some external reference.
	 * 
	 * External references may be reset, so this clock is not necessarily
	 * monotonic, making it unsuitable for measuring elapsed time.
	 * 
	 * It is intended for reporting the current date and time for humans.
	 */
	export namespace WallClock {
		
		/**
		 * A time and date in seconds plus nanoseconds.
		 */
		export type Datetime = {
			seconds: u64;
			nanoseconds: u32;
		};
		
		/**
		 * Read the current value of the clock.
		 * 
		 * This clock is not monotonic, therefore calling this function repeatedly
		 * will not necessarily produce a sequence of non-decreasing values.
		 * 
		 * The returned timestamps represent the number of seconds since
		 * 1970-01-01T00:00:00Z, also known as [POSIX's Seconds Since the Epoch],
		 * also known as [Unix Time].
		 * 
		 * The nanoseconds field of the output is always less than 1000000000.
		 * 
		 * [POSIX's Seconds Since the Epoch]: https://pubs.opengroup.org/onlinepubs/9699919799/xrat/V4_xbd_chap04.html#tag_21_04_16
		 * [Unix Time]: https://en.wikipedia.org/wiki/Unix_time
		 */
		export declare function now(): Datetime;
		
		/**
		 * Query the resolution of the clock.
		 * 
		 * The nanoseconds field of the output is always less than 1000000000.
		 */
		export declare function resolution(): Datetime;
	}
	export type WallClock = Pick<typeof WallClock, 'now' | 'resolution'>;
	
	export namespace Timezone {
		
		export type Datetime = clocks.WallClock.Datetime;
		
		/**
		 * Information useful for displaying the timezone of a specific `datetime`.
		 * 
		 * This information may vary within a single `timezone` to reflect daylight
		 * saving time adjustments.
		 */
		export type TimezoneDisplay = {
			
			/**
			 * The number of seconds difference between UTC time and the local
			 * time of the timezone.
			 * 
			 * The returned value will always be less than 86400 which is the
			 * number of seconds in a day (24*60*60).
			 * 
			 * In implementations that do not expose an actual time zone, this
			 * should return 0.
			 */
			utcOffset: s32;
			
			/**
			 * The abbreviated name of the timezone to display to a user. The name
			 * `UTC` indicates Coordinated Universal Time. Otherwise, this should
			 * reference local standards for the name of the time zone.
			 * 
			 * In implementations that do not expose an actual time zone, this
			 * should be the string `UTC`.
			 * 
			 * In time zones that do not have an applicable name, a formatted
			 * representation of the UTC offset may be returned, such as `-04:00`.
			 */
			name: string;
			
			/**
			 * Whether daylight saving time is active.
			 * 
			 * In implementations that do not expose an actual time zone, this
			 * should return false.
			 */
			inDaylightSavingTime: boolean;
		};
		
		/**
		 * Return information needed to display the given `datetime`. This includes
		 * the UTC offset, the time zone name, and a flag indicating whether
		 * daylight saving time is active.
		 * 
		 * If the timezone cannot be determined for the given `datetime`, return a
		 * `timezone-display` for `UTC` with a `utc-offset` of 0 and no daylight
		 * saving time.
		 */
		export declare function display(when: Datetime): TimezoneDisplay;
		
		/**
		 * The same as `display`, but only return the UTC offset.
		 */
		export declare function utcOffset(when: Datetime): s32;
	}
	export type Timezone = Pick<typeof Timezone, 'display' | 'utcOffset'>;
	
}

export namespace clocks {
	export namespace MonotonicClock.$ {
		export const Pollable = io.Poll.$.Pollable;
		export const Instant = $wcm.u64;
		export const now = new $wcm.FunctionType<typeof clocks.MonotonicClock.now>('now', 'now', [], Instant);
		export const resolution = new $wcm.FunctionType<typeof clocks.MonotonicClock.resolution>('resolution', 'resolution', [], Instant);
		export const subscribe = new $wcm.FunctionType<typeof clocks.MonotonicClock.subscribe>('subscribe', 'subscribe',[
			['when', Instant],
			['absolute', $wcm.bool],
		], new $wcm.OwnType<clocks.MonotonicClock.Pollable>(Pollable));
	}
	export namespace MonotonicClock._ {
		const allFunctions = [$.now, $.resolution, $.subscribe];
		export type WasmInterface = {
			'now': () => i64;
			'resolution': () => i64;
			'subscribe': (when: i64, absolute: i32, result: ptr<[]>) => void;
		};
		export function createHost<T extends $wcm.Host>(service: clocks.MonotonicClock, context: $wcm.Context): T {
			return $wcm.Host.create<T>(allFunctions, service, context);
		}
		export function createService(wasmInterface: $wcm.WasmInterface, context: $wcm.Context): clocks.MonotonicClock {
			return $wcm.Service.create<clocks.MonotonicClock>(allFunctions, wasmInterface, context);
		}
	}
	export namespace WallClock.$ {
		export const Datetime = new $wcm.RecordType<clocks.WallClock.Datetime>([
			['seconds', $wcm.u64],
			['nanoseconds', $wcm.u32],
		]);
		export const now = new $wcm.FunctionType<typeof clocks.WallClock.now>('now', 'now', [], Datetime);
		export const resolution = new $wcm.FunctionType<typeof clocks.WallClock.resolution>('resolution', 'resolution', [], Datetime);
	}
	export namespace WallClock._ {
		const allFunctions = [$.now, $.resolution];
		export type WasmInterface = {
			'now': (result: ptr<[i64, i32]>) => void;
			'resolution': (result: ptr<[i64, i32]>) => void;
		};
		export function createHost<T extends $wcm.Host>(service: clocks.WallClock, context: $wcm.Context): T {
			return $wcm.Host.create<T>(allFunctions, service, context);
		}
		export function createService(wasmInterface: $wcm.WasmInterface, context: $wcm.Context): clocks.WallClock {
			return $wcm.Service.create<clocks.WallClock>(allFunctions, wasmInterface, context);
		}
	}
	export namespace Timezone.$ {
		export const Datetime = clocks.WallClock.$.Datetime;
		export const TimezoneDisplay = new $wcm.RecordType<clocks.Timezone.TimezoneDisplay>([
			['utcOffset', $wcm.s32],
			['name', $wcm.wstring],
			['inDaylightSavingTime', $wcm.bool],
		]);
		export const display = new $wcm.FunctionType<typeof clocks.Timezone.display>('display', 'display',[
			['when', Datetime],
		], TimezoneDisplay);
		export const utcOffset = new $wcm.FunctionType<typeof clocks.Timezone.utcOffset>('utcOffset', 'utc-offset',[
			['when', Datetime],
		], $wcm.s32);
	}
	export namespace Timezone._ {
		const allFunctions = [$.display, $.utcOffset];
		export type WasmInterface = {
			'display': (when_Datetime_seconds: i64, when_Datetime_nanoseconds: i32, result: ptr<[i32, ptr<i32>, i32, i32]>) => void;
			'utc-offset': (when_Datetime_seconds: i64, when_Datetime_nanoseconds: i32) => i32;
		};
		export function createHost<T extends $wcm.Host>(service: clocks.Timezone, context: $wcm.Context): T {
			return $wcm.Host.create<T>(allFunctions, service, context);
		}
		export function createService(wasmInterface: $wcm.WasmInterface, context: $wcm.Context): clocks.Timezone {
			return $wcm.Service.create<clocks.Timezone>(allFunctions, wasmInterface, context);
		}
	}
}