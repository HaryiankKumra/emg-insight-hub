#!/usr/bin/env node
/**
 * Test script for Gemini API (Custom Fetch Wrapper)
 * Verifies that the custom fetch wrapper works with AQ.* gateway keys
 */

import fs from "fs";

// Read API key from .env file
const envContent = fs.readFileSync(".env", "utf-8");
const apiKeyMatch = envContent.match(/GEMINI_API_KEY=(.+)/);
const API_KEY = apiKeyMatch ? apiKeyMatch[1].trim() : null;

if (!API_KEY) {
  console.error("❌ GEMINI_API_KEY not found in .env");
  process.exit(1);
}

console.log(`\n🧪 Testing Gemini API with key: ${API_KEY.substring(0, 10)}...\n`);

async function testGeminiAPI() {
  try {
    // Initialize the client
    console.log("📍 Using custom fetch wrapper (Lovable gateway)...");

    // Get the model
    console.log("📍 Calling gemini-flash-latest model (Gemini 3.5 Flash)...");

    // Test prompt with EMG signal analysis context
    const testPrompt = `You are a biomedical signal analysis expert. Analyze this hypothetical EMG signal summary:
- Duration: 5 seconds
- Sample Rate: 1000 Hz
- Channel 1 (Tibialis Anterior): RMS=45mV, MAV=38mV, SNR=24dB
- Channel 2 (Soleus): RMS=52mV, MAV=44mV, SNR=26dB
- Dominant Frequency: 65Hz
- Exercise: Calf Raises

Provide a brief technical assessment in 2-3 sentences.`;

    console.log("📍 Sending request to Gemini API...");
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-goog-api-key": API_KEY,
        },
        body: JSON.stringify({
          system_instruction: {
            parts: [
              {
                text: "You are a precise biomedical signal-processing assistant.",
              },
            ],
          },
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: testPrompt,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.7,
            topP: 0.95,
            topK: 40,
            maxOutputTokens: 200,
          },
        }),
      },
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMsg = errorData.error?.message || response.statusText;
      throw new Error(`HTTP ${response.status}: ${errorMsg}`);
    }

    const result = await response.json();
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text ?? "(no response)";
    
    console.log("\n✅ API Test PASSED!\n");
    console.log("📋 Response from Gemini:\n");
    console.log(text);
    console.log("\n✨ Custom fetch wrapper works!\n");
    
    process.exit(0);
  } catch (error) {
    console.error("\n❌ API Test FAILED!\n");
    console.error("Error Details:");
    console.error(`- Type: ${error.name}`);
    console.error(`- Message: ${error.message}`);
    
    if (error.message.includes("API_KEY_INVALID") || error.message.includes("API key")) {
      console.error("\n💡 Issue: Invalid API key");
      console.error("   Action: Check GEMINI_API_KEY in .env file");
    } else if (error.message.includes("429") || error.message.includes("RESOURCE_EXHAUSTED")) {
      console.error("\n💡 Issue: API quota exceeded");
      console.error("   Action: Wait a few minutes and try again");
    }
    
    console.error("\n");
    process.exit(1);
  }
}

testGeminiAPI();
