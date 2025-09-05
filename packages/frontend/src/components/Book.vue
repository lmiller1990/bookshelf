<script setup lang="ts">
import type { ValidatedBook } from "@packages/shared/src/types.js";

defineProps<{
  book: ValidatedBook;
}>();
</script>

<template>
  <li>
    <strong>{{ book.validation?.title || book.title }}</strong>
    by {{ book.validation?.authors?.join(", ") || book.author }}
    <span v-if="book.validation?.isbn"> (ISBN: {{ book.validation.isbn }})</span>
  </li>
</template>