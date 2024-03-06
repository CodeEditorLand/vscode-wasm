// Generated by `wit-bindgen` 0.21.0. DO NOT EDIT!
#ifndef __BINDINGS_HOST_H
#define __BINDINGS_HOST_H
#ifdef __cplusplus
extern "C" {
#endif

#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <stdbool.h>

typedef struct {
  uint8_t*ptr;
  size_t len;
} host_string_t;

// Imported Functions from `host`
extern void host_print(host_string_t *msg);

// Exported Functions from `host`
void host_run(void);

// Helper Functions

// Transfers ownership of `s` into the string `ret`
void host_string_set(host_string_t *ret, char*s);

// Creates a copy of the input nul-terminate string `s` and
// stores it into the component model string `ret`.
void host_string_dup(host_string_t *ret, const char*s);

// Deallocates the string pointed to by `ret`, deallocating
// the memory behind the string.
void host_string_free(host_string_t *ret);

#ifdef __cplusplus
}
#endif
#endif
