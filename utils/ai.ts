
import { blobToBase64 } from './imageUtils';
import { AiSettings } from '../types';

export interface AiResponse {
  choices: {
    message: {
      content: string;
      role: string;
    }
  }[];
}

/**
 * Sends an image to an OpenAI-compatible API (GLM, OpenAI, Ollama, LM Studio) to extract text as Markdown.
 */
export const transcribeImage = async (
  imageBlob: Blob, 
  settings: AiSettings,
  onStatus?: (status: string) => void
): Promise<string> => {
  
  const { apiKey, baseUrl, model } = settings;

  // Ollama and LM Studio often don't strictly require an API key, but we shouldn't fail if it's empty unless the provider enforces it.
  // We'll let the request fail naturally if the server returns 401.

  // Convert Blob to Base64
  if (onStatus) onStatus("Encoding image...");
  
  // blobToBase64 returns raw base64 string (without data: prefix)
  const rawBase64 = await blobToBase64(imageBlob);
  // Construct standard Data URI for the API
  const mimeType = imageBlob.type || 'image/jpeg';
  const dataUri = `data:${mimeType};base64,${rawBase64}`;

  // Optimized System Prompt for various model sizes (including local/smaller models)
  // Using explicit structure (Task, Rules, Format) helps smaller models follow instructions better.
  // English instructions are generally followed better by base models, even for Chinese content tasks.
  const promptText = `[Task]
Analyze the image and transcribe the text content into Markdown format.

[Strict Rules]
1. Output ONLY the transcribed text. NO conversational fillers (e.g., "Here is the text", "Sure", "好的").
2. NO markdown code blocks (do not use \`\`\`).
3. If there is no text, return an empty string.
4. Preserve the original structure (headings, paragraphs).

[Formatting]
- Headings: Use #, ##, ###
- Lists: Use - or 1.
- Tables: Use Markdown table syntax
- Math: Use LaTeX format ($...$ for inline, $$...$$ for block)

[Language]
Keep the original language of the text found in the image. Do NOT translate.`;

  // Standard OpenAI Vision Payload
  const payload: any = {
    model: model,
    stream: false,
    temperature: 0.1, // Low temperature for factual extraction
    top_p: 0.1,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: {
              url: dataUri
            }
          },
          {
            type: "text",
            text: promptText
          }
        ]
      }
    ]
  };

  if (onStatus) onStatus(`Sending to ${model}...`);
  
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (apiKey && apiKey.trim() !== "") {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const response = await fetch(baseUrl, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`AI API Error (${response.status}): ${errText}`);
    }

    const data: AiResponse = await response.json();
    if (data.choices && data.choices.length > 0) {
      let content = data.choices[0].message.content;
      
      // Post-processing: Clean up common AI conversational fluff that leaks through despite instructions
      // 1. Remove wrapping code blocks if present (common in smaller models)
      content = content.replace(/^```markdown\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '');
      
      // 2. Remove common prefixes (English & Chinese)
      const prefixes = [
        "Here is the transcribed text:", 
        "Here is the text from the image:", 
        "Here is the text:",
        "The text in the image is:",
        "转换结果如下：", 
        "识别内容如下：", 
        "Sure, here is the markdown:",
        "Certainly!",
        "Okay,"
      ];
      
      for (const prefix of prefixes) {
         // Check case-insensitive start
         if (content.trim().toLowerCase().startsWith(prefix.toLowerCase())) {
            // Find actual index to slice correctly (preserving original casing of the rest)
            const idx = content.toLowerCase().indexOf(prefix.toLowerCase());
            if (idx !== -1) {
                content = content.substring(idx + prefix.length).trim();
            }
         }
      }

      return content;
    }
    return "";

  } catch (e) {
    console.error("AI Request Failed", e);
    throw e;
  }
};
