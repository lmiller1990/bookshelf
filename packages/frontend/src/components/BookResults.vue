<script setup lang="ts">
import type { ValidatedBook } from "@packages/shared/src/types.js";

defineProps<{
  books: ValidatedBook[];
  totalCandidates: number;
  validatedBooks: number;
}>();
</script>

<template>
  <div v-if="books && books.length > 0">
    <h3>📚 Books Found:</h3>
    <ul>
      <li v-for="book in books" :key="book.title">
        <strong>{{ book.validation?.title || book.title }}</strong>
        by {{ book.validation?.authors?.join(", ") || book.author }}
        <span v-if="book.validation?.isbn"> (ISBN: {{ book.validation.isbn }})</span>
      </li>
    </ul>
    <p>
      🎉 Processing Complete!
      Found {{ totalCandidates }} candidates, validated {{ validatedBooks }} books
    </p>
  </div>
  <div v-else>
    Processing complete - no books found in image
  </div>
</template>