import { mediaManager } from 'wix-media-backend';
import { fetch } from 'wix-fetch';

export async function processImageForAI(fileUrl, fileName) {
  try {
    console.log('Backend: Processing image for AI', fileUrl);
    
    // Get the download URL from Wix Media Manager
    const downloadUrl = await mediaManager.getDownloadUrl(fileUrl);
    console.log('Backend: Got download URL', downloadUrl);
    
    // Fetch the image from the download URL
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`);
    }
    
    // Get image as buffer
    const buffer = await response.arrayBuffer();
    console.log('Backend: Got image buffer, size:', buffer.byteLength);
    
    // Convert to base64
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
    const mimeType = response.headers.get('content-type') || 'image/jpeg';
    const dataUrl = `data:${mimeType};base64,${base64}`;
    
    console.log('Backend: Converted to base64, length:', dataUrl.length);
    
    return {
      success: true,
      base64Data: dataUrl,
      fileName: fileName,
      mimeType: mimeType,
      size: buffer.byteLength
    };
    
  } catch (error) {
    console.error('Backend: Error processing image:', error);
    return {
      success: false,
      error: error.message
    };
  }
}
