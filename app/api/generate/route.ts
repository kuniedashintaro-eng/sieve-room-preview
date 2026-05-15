import OpenAI, { toFile } from "openai";
import { NextResponse } from "next/server";
import { findSieveProduct } from "@/lib/sieveProducts";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_IMAGE_SIZE_BYTES = 50 * 1024 * 1024;
const SUPPORTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function readTextField(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
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

  const prompt = `This is a realistic room photo uploaded by the user. Place the selected SIEVE furniture naturally into the specified area of the room. Keep the original room structure, perspective, lighting, shadows, scale, floor contact, camera angle, and atmosphere. Do not change the room unnecessarily. Use only the selected SIEVE product as the furniture reference. Product name: ${selectedProduct.name}. Product description: ${selectedProduct.description}. Placement instruction: ${placementInstruction}. Generate a realistic interior preview image for EC purchase consideration.`;

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const imageBuffer = Buffer.from(await roomImage.arrayBuffer());
    const imageFile = await toFile(imageBuffer, roomImage.name || "room-image.jpg", {
      type: roomImage.type,
    });
    const productImageResponse = await fetch(selectedProduct.imageUrl);

    if (!productImageResponse.ok) {
      return errorResponse("SIEVEの商品画像を取得できませんでした。時間をおいて再度お試しください。", 502);
    }

    const productImageBuffer = Buffer.from(await productImageResponse.arrayBuffer());
    const productImageFile = await toFile(productImageBuffer, `${selectedProduct.id}.jpg`, {
      type: productImageResponse.headers.get("content-type") || "image/jpeg",
    });

    const result = await client.images.edit({
      model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
      image: [imageFile, productImageFile],
      prompt,
      input_fidelity: "high",
      size: "1024x1024",
    });

    const imageBase64 = result.data?.[0]?.b64_json;

    if (!imageBase64) {
      return errorResponse("画像生成結果を取得できませんでした。時間をおいて再度お試しください。", 502);
    }

    return NextResponse.json({
      image: `data:image/png;base64,${imageBase64}`,
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
