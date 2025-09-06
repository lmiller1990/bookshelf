<script setup lang="ts">
import type { ValidatedBook } from "@packages/shared/src/types.js";

defineProps<{
  book: ValidatedBook;
}>();
</script>

<template>
  <div class="grid grid-cols-1 md:grid-cols-[1fr_150px]">
    <div>
      <div>
        <strong>{{ book.validation?.title || book.title }}</strong>
      </div>
      <div>by {{ book.validation?.authors?.join(", ") || book.author }}</div>
    </div>
    <div>
      <span
        v-if="book.validation?.isbn"
        class="hidden md:block w-[150px] text-right"
      >
        ISBN: {{ book.validation.isbn }}</span
      >
    </div>
  </div>
</template>
