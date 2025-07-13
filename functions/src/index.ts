// =========================================================
// Imports
// =========================================================
import { onCall, type CallableRequest, HttpsError } from 'firebase-functions/v2/https';
import { genkit, z } from 'genkit';
import { gemini, googleAI } from '@genkit-ai/googleai';
import * as admin from 'firebase-admin';

// =========================================================
// Initialize Firebase Admin SDK
// =========================================================
admin.initializeApp();
const db = admin.firestore();

// =========================================================
// Initialize Genkit
// =========================================================
// This log helps confirm the function is reading the environment variable on startup.
if (process.env.GEMINI_API_KEY) {
    console.log("SUCCESS: GEMINI_API_KEY environment variable was loaded.");
} else {
    // This error will appear in your Cloud Function logs if the variable is not set correctly in the GCP console.
    console.error("CRITICAL FAILURE: GEMINI_API_KEY environment variable NOT found.");
}

const ai = genkit({
    plugins: [
        googleAI({
            apiKey: process.env.GEMINI_API_KEY, // Reads the key set in the GCP Console
        }),
    ],
    // FINAL FIX: Using the correct, current model name.
    model: gemini('gemini-1.0-pro'),
});

// =========================================================
// Genkit Flow Definition: rpgAssistantFlow
// =========================================================
export const rpgAssistantFlow = ai.defineFlow(
    {
        name: 'rpgAssistant',
        inputSchema: z.object({
            userPrompt: z.string().describe("The user's request or question for the AI assistant."),
            conversationHistory: z.array(z.object({
                role: z.enum(['user', 'model']),
                parts: z.array(z.object({ text: z.string() })),
            })).optional(),
        }),
        outputSchema: z.string().describe('The AI-generated response.'),
    },
    async (input: { userPrompt: string, conversationHistory?: any[] }) => {
        const { userPrompt, conversationHistory } = input;

        const fullPrompt = `You are Bastion, a helpful, creative, and knowledgeable assistant for the Tangent SFF RPG.
        The user's current request is: "${userPrompt}"
        Please provide a concise, relevant, and creative response.`;

        const response = await ai.generate({
            prompt: fullPrompt,
            history: conversationHistory, // Pass history directly to the model
            config: {
                temperature: 0.7,
                maxOutputTokens: 500,
            },
        });

        return response.text;
    }
);

// =========================================================
// Cloud Function: callRpgAssistantV2
// =========================================================
export const callRpgAssistantV2 = onCall(
    {
        timeoutSeconds: 300,
        memory: "512MiB",
        cors: /.*/, // Allow all origins
    },
    async (request: CallableRequest<{ userPrompt: string, conversationHistory: any[] }>) => {
        // This log message is added to force a redeployment.
        console.log("Executing function version 3.0...");

        // 1. Authentication Check
        if (!request.auth) {
            console.error("Function call failed: Unauthenticated.");
            throw new HttpsError('unauthenticated', 'The AI assistant requires authentication.');
        }

        // 2. Input Validation
        const { userPrompt, conversationHistory } = request.data;
        if (!userPrompt || typeof userPrompt !== 'string') {
            console.error("Function call failed: Invalid userPrompt.", { data: request.data });
            throw new HttpsError('invalid-argument', 'The function expects a valid "userPrompt" string.');
        }

        console.log(`V2 function invoked by user ${request.auth.uid} with prompt: "${userPrompt}"`);

        // 3. Execute the AI Flow
        try {
            const aiResponse = await rpgAssistantFlow.run({ userPrompt, conversationHistory });
            console.log("Successfully received response from AI flow.");
            return { response: aiResponse };
        } catch (error) {
            console.error("CRITICAL: Error executing RPG Assistant Flow:", error);
            if (error instanceof Error && 'message' in error) {
                console.error("Underlying error message:", error.message);
            }
            throw new HttpsError('internal', 'An internal error occurred while processing your request. Check the function logs for details.');
        }
    }
);
