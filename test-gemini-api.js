#!/usr/bin/env node
/**
 * Test script for Gemini API
 * Verifies that the new API key and @google/generative-ai package work correctly
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
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
    console.log("📍 Initializing GoogleGenerativeAI client...");
    const ai = new GoogleGenerativeAI({ apiKey: API_KEY });

    // Get the model
    console.log("📍 Loading gemini-1.5-flash model...");
    const model = ai.getGenerativeModel({ model: "gemini-1.5-flash" });

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
    const result = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [{ text: testPrompt }],
        },
      ],
      generationConfig: {
        temperature: 0.7,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 200,
      },
    });

    const response = result.response.text();
    
    console.log("\n✅ API Test PASSED!\n");
    console.log("📋 Response from Gemini:\n");
    console.log(response);
    console.log("\n✨ API is working correctly!\n");
    
    process.exit(0);
  } catch (error) {
    console.error("\n❌ API Test FAILED!\n");
    console.error("Error Details:");
    console.error(`- Type: ${error.name}`);
    console.error(`- Message: ${error.message}`);
    
    if (error.message.includes("UNAUTHENTICATED")) {
      console.error("\n💡 Issue: Invalid or expired API key");
      console.error("   Action: Check GEMINI_API_KEY in .env file");
    } else if (error.message.includes("RESOURCE_EXHAUSTED")) {
      console.error("\n💡 Issue: API quota exceeded");
      console.error("   Action: Wait a few minutes and try again");
    } else if (error.message.includes("Invalid API Key")) {
      console.error("\n💡 Issue: API key format is incorrect");
      console.error("   Action: Verify the key format (should start with AQ. or AIza)");
    }
    
    console.error("\n");
    process.exit(1);
  }
}

testGeminiAPI();
