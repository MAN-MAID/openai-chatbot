// backend/imageHandler.js
import { mediaManager } from 'wix-media-backend';

export async function uploadBase64Image(base64Data, fileName) {
  try {
    console.log("Backend: Processing base64 image upload");
    
    // Remove data URL prefix if present
    const base64String = base64Data.includes(',') 
      ? base64Data.split(',')[1] 
      : base64Data;
    
    // Create buffer from base64
    const buffer = Buffer.from(base64String, 'base64');
    
    console.log("Backend: Buffer created, size:", buffer.length);
    
    // Upload to Wix Media Manager
    const uploadResult = await mediaManager.upload(
      "/AI-Images", // Folder in Media Manager
      buffer,
      fileName || "uploaded-image.jpg",
      {
        "mediaOptions": {
          "mimeType": "image/jpeg",
          "mediaType": "image"
        },
        "metadataOptions": {
          "isPrivate": false,
          "isVisitorUpload": true
        }
      }
    );
    
    console.log("Backend: Upload successful:", uploadResult);
    
    // Get a download URL for the uploaded file
    const downloadUrl = await mediaManager.getDownloadUrl(uploadResult.fileUrl);
    
    console.log("Backend: Download URL obtained:", downloadUrl);
    
    return {
      success: true,
      fileUrl: uploadResult.fileUrl,
      downloadUrl: downloadUrl,
      fileName: uploadResult.fileName
    };
    
  } catch (error) {
    console.error("Backend: Upload error:", error);
    return {
      success: false,
      error: error.message
    };
  }
}
