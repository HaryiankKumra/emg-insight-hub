#!/usr/bin/env node
const fs = require('fs');

const envContent = fs.readFileSync('.env', 'utf-8');
const apiKeyMatch = envContent.match(/GEMINI_API_KEY=(.+)/);
const API_KEY = apiKeyMatch ? apiKeyMatch[1].trim() : null;

if (!API_KEY) {
  console.error("❌ API_KEY not found");
  process.exit(1);
}

console.log(`\n🧪 Testing Gemini Fetch API with key: ${API_KEY.substring(0, 10)}...\n`);

async function testAPI() {
  try {
    console.log("📍 Sending request to gemini-flash-latest...");
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-goog-api-key": API_KEY,
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: "Explain EMG signal processing in one sentence",
                },
              ],
            },
          ],
          generationConfig: {
            maxOutputTokens: 150,
          },
          systemInstruction: "You are a biomedical signal expert.",
        }),
      },
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`HTTP ${response.status}: ${JSON.stringify(errorData)}`);
    }

    const result = await response.json();
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text;

    console.log("\n✅ API Test PASSED!\n");
    console.log("📋 Response:\n");
    console.log(text);
    console.log("\n✨ Custom fetch wrapper works!\n");
    process.exit(0);
  } catch (error) {
    console.error("\n❌ API Test FAILED!\n");
    console.error("Error:", error.message);
    console.error();
    process.exit(1);
  }
}

testAPI();
