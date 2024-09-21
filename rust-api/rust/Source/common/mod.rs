/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
use std::{cell::RefCell, fmt::Debug, rc::Rc};

use indexmap::IndexMap;

pub struct EventEmitter<T>
where
	T: Debug + 'static,
{
	next_id: u32,
	hook: fn(),
	unhook: fn(),
	listeners: Rc<RefCell<IndexMap<u32, Box<dyn Fn(&T)>>>>,
}

impl<T> EventEmitter<T>
where
	T: Debug + 'static,
{
	pub fn new(hook: fn(), unhook: fn()) -> Self {
		EventEmitter { next_id: 1, hook, unhook, listeners: Rc::new(RefCell::new(IndexMap::new())) }
	}

	pub fn on<F>(&mut self, listener: F) -> impl Fn() + 'static
	where
		F: Fn(&T) + 'static,
	{
		if self.listeners.borrow().len() == 0 {
			(self.hook)();
		}
		let id = self.next_id;
		self.next_id += 1;
		self.listeners.borrow_mut().insert(id, Box::new(listener));

		let listeners = self.listeners.clone();
		let unhook = self.unhook.clone();

		return move || {
			listeners.borrow_mut().shift_remove(&id);
			if listeners.borrow().len() == 0 {
				(unhook)();
			}
		};
	}

	pub fn fire(&self, event: &T) {
		for listener in self.listeners.borrow().values() {
			listener(event);
		}
	}
}
