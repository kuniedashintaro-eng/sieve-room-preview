import { NextResponse } from "next/server";
import {
  GENERATION_LIMIT,
  getQuotaMode,
  getRemainingGenerations,
  resetRemainingGenerations,
} from "@/lib/quotaStore";

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET() {
  try {
    const mode = getQuotaMode();
    const remaining = await getRemainingGenerations();

    return NextResponse.json({
      limit: GENERATION_LIMIT,
      mode,
      remaining,
    });
  } catch (error) {
    console.error("Quota read failed:", error);

    return errorResponse(
      "共有の利用回数を読み取れませんでした。時間をおいて再度お試しください。",
      500,
    );
  }
}

export async function POST(request: Request) {
  let body: { action?: string; code?: string };

  try {
    body = (await request.json()) as { action?: string; code?: string };
  } catch {
    return errorResponse("リセット情報を読み取れませんでした。");
  }

  if (body.action !== "reset") {
    return errorResponse("未対応の操作です。");
  }

  if (body.code !== "19910114") {
    return errorResponse("認証に失敗しました", 401);
  }

  try {
    const mode = getQuotaMode();
    const remaining = await resetRemainingGenerations();

    return NextResponse.json({
      limit: GENERATION_LIMIT,
      mode,
      remaining,
    });
  } catch (error) {
    console.error("Quota reset failed:", error);

    return errorResponse(
      "共有の利用回数をリセットできませんでした。時間をおいて再度お試しください。",
      500,
    );
  }
}
