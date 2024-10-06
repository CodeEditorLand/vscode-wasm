// ---------------------------------------------------------------------------------------------
//  Copyright (c) Microsoft Corporation. All rights reserved.
//  Licensed under the MIT License. See License.txt in the project root for
// license information.
// --------------------------------------------------------------------------------------------

use crate::host::api::{
	languages,
	types::{DocumentSelector, TextDocument},
};

#[allow(non_upper_case_globals)]
pub const match_selector:fn(selector:&DocumentSelector, document:TextDocument) -> u32 =
	languages::match_selector;
