import OpenAI, { toFile } from "openai";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { findSieveProduct } from "@/lib/sieveProducts";
import { decrementRemainingGenerations, getRemainingGenerations } from "@/lib/quotaStore";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_IMAGE_SIZE_BYTES = 50 * 1024 * 1024;
const SUPPORTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const IMAGE_MODEL = "gpt-image-2";

function readTextField(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function getSeatCountInstruction(productName: string, productCategory: string) {
  const source = `${productName} ${productCategory}`;

  if (source.includes("4人掛け")) {
    return "The selected product is a 4-seater sofa. It must look like a 4-seater sofa with the correct length and seating capacity. Do not make it smaller or change it into a 1-seater, 2-seater, or 3-seater.";
  }

  if (source.includes("3人掛け")) {
    return "The selected product is a 3-seater sofa. It must look like a 3-seater sofa with the correct length and seating capacity. Do not make it smaller or larger, and do not change it into a 1-seater, 2-seater, or 4-seater.";
  }

  if (source.includes("2人掛け")) {
    return "The selected product is a 2-seater sofa. It must clearly remain a 2-seater sofa with the correct compact width and two-person seating capacity. Do not stretch it into a 3-seater or 4-seater sofa.";
  }

  if (source.includes("1人掛け")) {
    return "The selected product is a 1-seater sofa. It must clearly remain a single-seat chair-sized sofa for one person. Do not enlarge it into a 2-seater, 3-seater, or 4-seater sofa.";
  }

  if (source.includes("オットマン")) {
    return "The selected product is an ottoman. It must remain an ottoman, not a sofa with a backrest or armrests.";
  }

  return "";
}

async function normalizeImageForOpenAI(buffer: Buffer) {
  return sharp(buffer, { failOn: "none" })
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({
      width: 1280,
      height: 1280,
      fit: "inside",
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();
}

export async function POST(request: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return errorResponse(
      "OPENAI_API_KEY が設定されていません。Vercelまたはローカル環境変数を確認してください。",
      500,
    );
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return errorResponse("フォームデータを読み取れませんでした。画像と入力内容を確認してください。");
  }

  const roomImage = formData.get("roomImage");
  const productId = readTextField(formData, "productId");
  const placementInstruction = readTextField(formData, "placementInstruction");
  const selectedProduct = findSieveProduct(productId);

  if (!(roomImage instanceof File)) {
    return errorResponse("部屋画像をアップロードしてください。");
  }

  if (!selectedProduct) {
    return errorResponse("SIEVE公式商品のリストから商品を選択してください。");
  }

  if (!placementInstruction) {
    return errorResponse("配置場所・指示を入力してください。");
  }

  if (!SUPPORTED_TYPES.has(roomImage.type)) {
    return errorResponse("画像は JPG、PNG、WebP のいずれかをアップロードしてください。");
  }

  if (roomImage.size > MAX_IMAGE_SIZE_BYTES) {
    return errorResponse("画像サイズが大きすぎます。50MB未満の画像をアップロードしてください。");
  }

  const remainingBeforeGeneration = await getRemainingGenerations();

  if (remainingBeforeGeneration !== null && remainingBeforeGeneration <= 0) {
    return errorResponse("利用回数が上限に達しています。", 403);
  }

  const seatCountInstruction = getSeatCountInstruction(
    selectedProduct.name,
    selectedProduct.category,
  );
  const prompt = `This is a realistic room photo uploaded by the user. The second input image is the highest-priority visual reference for the selected SIEVE furniture. Use the furniture body in the second image as the exact reference for shape, silhouette, seating capacity, arm/back position, legs, frame, cushions, upholstery texture, material, visible seams, color, and proportions. Ignore and do not reproduce any lifestyle props, people, hands, blankets, pillows that are not part of the product, trays, cups, rugs, plants, walls, floors, windows, lighting fixtures, tables, background rooms, labels, thumbnails, color swatches, or alternate color variations visible in the product reference. Prioritize only the selected furniture's main visible color and material from the reference image; do not mix in other color variants. Place that exact selected SIEVE furniture naturally into the specified area of the user's room. ${seatCountInstruction} Keep the original room structure, perspective, lighting, shadows, scale, floor contact, camera angle, and atmosphere. Do not change the room unnecessarily. Do not turn the furniture into a bed, mattress, different sofa type, different seating count, or a generic similar product. Use only the selected SIEVE product as the furniture reference. Product name: ${selectedProduct.name}. Product category: ${selectedProduct.category}. Product description: ${selectedProduct.description}. Placement instruction: ${placementInstruction}. Generate a realistic interior preview image for EC purchase consideration.`;

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const imageBuffer = await normalizeImageForOpenAI(Buffer.from(await roomImage.arrayBuffer()));
    const imageFile = await toFile(imageBuffer, "room-image.png", {
      type: "image/png",
    });
    const productReferenceImageUrl = selectedProduct.referenceImageUrl ?? selectedProduct.imageUrl;
    const productImageResponse = await fetch(productReferenceImageUrl);

    if (!productImageResponse.ok) {
      return errorResponse("SIEVEの商品画像を取得できませんでした。時間をおいて再度お試しください。", 502);
    }

    const productImageBuffer = await normalizeImageForOpenAI(
      Buffer.from(await productImageResponse.arrayBuffer()),
    );
    const productImageFile = await toFile(productImageBuffer, `${selectedProduct.id}.png`, {
      type: "image/png",
    });

    const result = await client.images.edit({
      model: IMAGE_MODEL,
      image: [imageFile, productImageFile],
      prompt,
      size: "1024x1024",
    });

    const imageBase64 = result.data?.[0]?.b64_json;

    if (!imageBase64) {
      return errorResponse("画像生成結果を取得できませんでした。時間をおいて再度お試しください。", 502);
    }

    const remaining = await decrementRemainingGenerations();

    return NextResponse.json({
      image: `data:image/png;base64,${imageBase64}`,
      remaining,
    });
  } catch (error) {
    console.error("Image edit failed:", error);

    const message =
      error instanceof Error && error.message
        ? error.message
        : "画像生成中に予期しないエラーが発生しました。";

    return errorResponse(
      `画像生成に失敗しました。入力画像、APIキー、利用上限を確認してください。詳細: ${message}`,
      500,
    );
  }
}
