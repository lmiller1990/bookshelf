<script setup lang="ts">
import { ref } from "vue";
import type { ValidatedBook } from "@packages/shared/src/types.js";
import Book from "./components/Book.vue";
import Hero from "./components/Hero.vue";

const fileInput = ref<HTMLInputElement | null>(null);
const status = ref<string>("");
const statusType = ref<"info" | "success" | "error">("info");
const isUploading = ref(false);
const processingStages = ref<{ [key: string]: boolean }>({
  textract: false,
  bedrock: false,
  validation: false,
});

// Configuration - loaded from environment variables
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
const WEBSOCKET_URL = import.meta.env.VITE_WEBSOCKET_URL;

if (!API_BASE_URL || !WEBSOCKET_URL) {
  console.error("Missing environment variables:", {
    VITE_API_BASE_URL: API_BASE_URL,
    VITE_WEBSOCKET_URL: WEBSOCKET_URL,
  });
}

let websocket: WebSocket | null = null;

const testBooks: ValidatedBook[] = [
  {
    title: "TRANSFORMER",
    author: "NICK LANE",
    subtitle: null,
    confidence: 0.9,
    validation: {
      validated: true,
      title: "Transformer",
      authors: ["Nick Lane"],
      isbn: "9781782834502",
      publishedDate: "2022-05-19",
      publisher: "Profile Books",
      thumbnail:
        "http://books.google.com/books/content?id=Tf-sDwAAQBAJ&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api",
    },
    status: "validated",
  },
  {
    title: "Numbers Don't Lie",
    author: "Vaclav Smil",
    subtitle: null,
    confidence: 0.8,
    validation: {
      validated: true,
      title: "Numbers Don't Lie",
      authors: ["Vaclav Smil"],
      isbn: "9780241989708",
      publishedDate: "2020-10-01",
      publisher: "Penguin UK",
      thumbnail:
        "http://books.google.com/books/content?id=e3_NDwAAQBAJ&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api",
    },
    status: "validated",
  },
  {
    title: "THE POSSIBILITY OF LIFE",
    author: "JAIME GREENE",
    subtitle: null,
    confidence: 0.9,
    validation: {
      validated: true,
      title: "Luke-Acts Improv: Biblical Narratives That Get You Into the Act",
      authors: ["Jamie Greene"],
      isbn: "9780979907623",
      publishedDate: "2010-12",
      publisher: "Harmon Press",
      thumbnail:
        "http://books.google.com/books/content?id=VsXdekJG-w8C&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api",
    },
    status: "validated",
  },
  {
    title: "LIFE'S ENGINES",
    author: "PAUL FALKOWSKI",
    subtitle: null,
    confidence: 0.8,
    validation: {
      validated: true,
      title: "Life's Engines",
      authors: ["Paul G. Falkowski"],
      isbn: "9780691247687",
      publishedDate: "2023-06-13",
      publisher: "Princeton University Press",
      thumbnail:
        "http://books.google.com/books/content?id=pTWiEAAAQBAJ&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api",
    },
    status: "validated",
  },
  {
    title: "FOLLOW YOUR GUT",
    author: "Stinson Hutchings",
    subtitle: "The Remarkable Science of Stomach Microbes",
    confidence: 0.9,
    validation: {
      validated: true,
      title: "Follow Your Gut",
      authors: ["Ailsa Wild", "Briony Barr", "Gregory Crocetti"],
      isbn: "9781761385735",
      publishedDate: "2024-07-30",
      publisher: "Scribe Publications",
      thumbnail:
        "http://books.google.com/books/content?id=tSHzEAAAQBAJ&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api",
    },
    status: "validated",
  },
  {
    title: "The Bitcoin Standard",
    author: "SAIFEDEAN AMMOUS",
    subtitle: null,
    confidence: 0.9,
    validation: {
      validated: true,
      title:
        "Summary of the Bitcoin Standard: The Decentralized Alternative to Central Banking by Saifedean Ammous",
      authors: ["Dennis Braun"],
      isbn: "1794059768",
      publishedDate: "2019-01-13",
      publisher: "Independently Published",
      thumbnail:
        "http://books.google.com/books/content?id=UgUywQEACAAJ&printsec=frontcover&img=1&zoom=1&source=gbs_api",
    },
    status: "validated",
  },
  {
    title: "50 Mathematical Ideas You Really Need to Know",
    author: "Tony Crilly",
    subtitle: null,
    confidence: 0.9,
    validation: {
      validated: true,
      title: "50 Maths Ideas You Really Need to Know",
      authors: ["Tony Crilly"],
      isbn: "1529425158",
      publishedDate: "2022-08-18",
      publisher: "50 Ideas You Really Need to Know series",
      thumbnail:
        "http://books.google.com/books/content?id=eEzezgEACAAJ&printsec=frontcover&img=1&zoom=1&source=gbs_api",
    },
    status: "validated",
  },
  {
    title: "FROM BACTERIA TO BACH AND BACK",
    author: "DANIEL C. DENNETT",
    subtitle: null,
    confidence: 0.9,
    validation: {
      validated: true,
      title: "From Bacteria to Bach and Back",
      authors: ["Daniel C. Dennett"],
      isbn: "9780141978055",
      publishedDate: "2017-02-21",
      publisher: "Penguin UK",
      thumbnail:
        "http://books.google.com/books/content?id=XuJoDQAAQBAJ&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api",
    },
    status: "validated",
  },
  {
    title: "THE GENETIC LOTTERY",
    author: "KATHRYN PAIGE HARDEN",
    subtitle: "Why DNA Matters for Social Equality",
    confidence: 0.9,
    validation: {
      validated: true,
      title: "The Genetic Lottery",
      authors: ["Kathryn Paige Harden"],
      isbn: "0691234779",
      publishedDate: "2021",
    },
    status: "validated",
  },
  {
    title: "Rebel Cell",
    author: "Kat Arney",
    subtitle: "Cancer, Evolution and the Science of Life",
    confidence: 0.9,
    validation: {
      validated: true,
      title: "Rebel Cell",
      authors: ["Kat Arney"],
      isbn: "9781474609326",
      publishedDate: "2020-08-06",
      publisher: "Hachette UK",
      thumbnail:
        "http://books.google.com/books/content?id=yDmcDwAAQBAJ&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api",
    },
    status: "validated",
  },
  {
    title: "HOW TO SPEND A TRILLION DOLLARS",
    author: "ROWAN HOOPER",
    subtitle: null,
    confidence: 0.9,
    validation: {
      validated: true,
      title: "How to Spend a Trillion Dollars",
      authors: ["Rowan Hooper"],
      isbn: "9781782836100",
      publishedDate: "2021-01-14",
      publisher: "Profile Books",
      thumbnail:
        "http://books.google.com/books/content?id=RHTyDwAAQBAJ&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api",
    },
    status: "validated",
  },
];

const books = ref<ValidatedBook[]>(testBooks)
const imageSelected = ref(false);

const handleFileUpload = async () => {
  const file = fileInput.value?.files?.[0];
  if (!file) {
    return;
  }
  console.log(`Uploading ${file}`);

  isUploading.value = true;
  console.log(`Getting upload URL...`);

  try {
    // Get pre-signed URL
    const response = await fetch(
      `${API_BASE_URL}/upload-url?filename=${encodeURIComponent(file.name)}&contentType=${encodeURIComponent(file.type)}`,
    );

    if (!response.ok) {
      throw new Error("Failed to get upload URL");
    }

    const signedUrl = await response.text();
    console.log(`URL is => ${signedUrl}`);

    // Extract jobId from signed URL
    const urlParts = new URL(signedUrl);
    const s3Key = urlParts.pathname.substring(1); // Remove leading slash
    const jobId = s3Key.split("/")[0]; // Get directory name as jobId

    // Connect to WebSocket before uploading
    console.log("Connecting to websocket");
    await connectWebSocket(jobId);
    console.log("OK connected!");

    // Upload to S3
    console.log("Upload time");
    const uploadResponse = await fetch(signedUrl, {
      method: "PUT",
      body: file,
      headers: {
        "Content-Type": file.type,
      },
    });

    if (uploadResponse.ok) {
      console.log("we did it!", jobId);
    } else {
      websocket?.close();
      isUploading.value = false;
    }
  } catch (error) {
    console.log(
      `Upload error: ${error instanceof Error ? error.message : "Unknown error"}`,
      "error",
    );
    websocket?.close();
    isUploading.value = false;
  }
};

function handleBookedProcessed(_books: ValidatedBook[]) {
  books.value = _books;
}

const connectWebSocket = (jobId: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    websocket = new WebSocket(WEBSOCKET_URL);

    websocket.onopen = () => {
      console.log("WebSocket connected");
      // Subscribe to job notifications
      websocket?.send(
        JSON.stringify({
          action: "subscribe",
          jobId: jobId,
        }),
      );
      resolve();
    };

    websocket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log("WebSocket message:", data);

        if (data.type === "subscribed") {
          console.log("🔗 Connected to real-time updates", "info");
        } else if (data.type === "processingStage") {
          console.log(`Processing stage: ${data.stage} - ${data.status}`, data);

          if (data.status === "started") {
            processingStages.value[data.stage] = true;

            // Update status based on stage
            switch (data.stage) {
              case "textract":
                status.value = "Extracting text from image...";
                break;
              case "bedrock":
                status.value = "Analyzing text with AI...";
                break;
              case "validation":
                status.value = "Validating book information...";
                break;
            }
            statusType.value = "info";
          } else if (data.status === "completed") {
            // Keep stage marked as complete
            console.log(`${data.stage} completed with details:`, data.details);
          }
        } else if (data.type === "processingComplete") {
          console.log("processingComplete", data);
          handleBookedProcessed(data.results.books);
          status.value = "Processing complete!";
          statusType.value = "success";
          console.log("Processing complete!", "success");
          websocket?.close();
          isUploading.value = false;

          // Reset processing stages
          processingStages.value = {
            textract: false,
            bedrock: false,
            validation: false,
          };
        }
      } catch (e) {
        console.error("Error parsing WebSocket message:", e);
      }
    };

    websocket.onerror = (error) => {
      console.error("WebSocket error:", error);
      reject(error);
    };

    websocket.onclose = () => {
      console.log("WebSocket disconnected");
      isUploading.value = false;
    };
  });
};

const handleFileSelect = (event: Event) => {
  const target = event.target as HTMLInputElement;
  imageSelected.value = Boolean(target.files && target.files[0]);
};
</script>

<template>
  <div class="h-full flex justify-center">
    <div class="grid md:grid-cols-[1fr_1fr] h-full w-full max-w-7xl">
      <div class="flex flex-col items-center mb-1">
        <Hero />

        <div class="flex flex-col max-w-[20rem]">
          <input
            class="file-input mb-2"
            ref="fileInput"
            type="file"
            accept="image/*"
            @change="handleFileSelect"
            :disabled="isUploading"
          />

          <button
            class="btn btn-primary"
            @click="handleFileUpload"
            :disabled="isUploading || !imageSelected"
          >
            {{ isUploading ? "Processing..." : "Upload Image" }}
          </button>

          <!-- Processing Progress Indicator -->
          <div v-if="isUploading" class="mt-4">
            <div class="text-sm text-gray-600 mb-2">{{ status }}</div>
            <div class="flex space-x-2">
              <div
                class="flex items-center space-x-1"
                :class="
                  processingStages.textract ? 'text-blue-600' : 'text-gray-400'
                "
              >
                <div
                  class="w-2 h-2 rounded-full"
                  :class="
                    processingStages.textract ? 'bg-blue-600' : 'bg-gray-400'
                  "
                ></div>
                <span class="text-xs">Text Extraction</span>
              </div>
              <div
                class="flex items-center space-x-1"
                :class="
                  processingStages.bedrock ? 'text-blue-600' : 'text-gray-400'
                "
              >
                <div
                  class="w-2 h-2 rounded-full"
                  :class="
                    processingStages.bedrock ? 'bg-blue-600' : 'bg-gray-400'
                  "
                ></div>
                <span class="text-xs">AI Analysis</span>
              </div>
              <div
                class="flex items-center space-x-1"
                :class="
                  processingStages.validation
                    ? 'text-blue-600'
                    : 'text-gray-400'
                "
              >
                <div
                  class="w-2 h-2 rounded-full"
                  :class="
                    processingStages.validation ? 'bg-blue-600' : 'bg-gray-400'
                  "
                ></div>
                <span class="text-xs">Book Validation</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="m-2">
        <div
          class="text-sm grid grid-cols-1 bg-grey-400 gap-[3px] auto-rows-max"
        >
          <div
            class="p-2 bg-base-200 rounded-sm"
            v-for="book in books"
            :key="book.title"
          >
            <Book :book="book" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
