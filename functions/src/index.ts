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
if (process.env.GEMINI_API_KEY) {
    console.log("V3: GEMINI_API_KEY environment variable was loaded successfully.");
} else {
    console.error("V3: CRITICAL FAILURE - GEMINI_API_KEY environment variable NOT found.");
}

const ai = genkit({
    plugins: [
        googleAI({
            apiKey: process.env.GEMINI_API_KEY,
        }),
    ],
    model: gemini('gemini-1.5-flash'),
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
        const fullPrompt = `You are Bastion, a helpful assistant for the Tangent SFF RPG.`;
        const response = await ai.generate({
            prompt: fullPrompt,
            history: conversationHistory,
            config: { temperature: 0.7, maxOutputTokens: 500 },
        });
        return response.text();
    }
);

// =========================================================
// Cloud Function: callRpgAssistantV3
// =========================================================
export const callRpgAssistantV3 = onCall(
    {
        timeoutSeconds: 300,
        memory: "512MiB",
        cors: /.*/,
    },
    async (request: CallableRequest<{ userPrompt: string, conversationHistory: any[] }>) => {
        console.log("Executing function version V3 (Clean Slate)...");

        if (!request.auth) {
            throw new HttpsError('unauthenticated', 'The function requires authentication.');
        }

        const { userPrompt, conversationHistory } = request.data;
        if (!userPrompt || typeof userPrompt !== 'string') {
            throw new HttpsError('invalid-argument', 'The function expects a valid "userPrompt" string.');
        }

        try {
            const aiResponseText = await rpgAssistantFlow.run({ userPrompt, conversationHistory });

            // FIX: Explicitly cast the response to a primitive string to prevent serialization errors.
            // A complex object can sometimes log as a string but fail to serialize.
            const responsePayload = {
                response: `${aiResponseText}`
            };

            console.log("Successfully prepared payload. Sending to client.");
            return responsePayload;

        } catch (error: any) {
            console.error("CRITICAL ERROR in V3:", error);
            throw new HttpsError('internal', 'An internal error occurred. Check function logs for debug trace.');
        }
    }
);
