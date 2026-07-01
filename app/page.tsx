"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { SIEVE_PRODUCT_CATEGORIES, SIEVE_PRODUCTS } from "@/lib/sieveProducts";

const WARNING_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_SIZE_BYTES = 50 * 1024 * 1024;
const TARGET_UPLOAD_SIZE_BYTES = 3 * 1024 * 1024;
const MAX_UPLOAD_IMAGE_DIMENSION = 1600;
const GENERATION_LIMIT = 100;
const STORAGE_KEY = "sieve-room-preview-remaining-generations";
type QuotaMode = "local" | "shared";
type GeneratePayload = { image?: string; error?: string; remaining?: number | null };

function formatFileSize(bytes: number) {
  const mb = bytes / 1024 / 1024;
  return `${mb.toFixed(mb >= 10 ? 0 : 1)}MB`;
}

function getImageExtension(file: File) {
  return "jpg";
}

function blobToFile(blob: Blob, fileName: string) {
  return new File([blob], fileName, {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
}

async function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }

        reject(new Error("画像の軽量化に失敗しました。別の画像をお試しください。"));
      },
      "image/jpeg",
      quality,
    );
  });
}

async function compressImageForUpload(file: File) {
  const objectUrl = URL.createObjectURL(file);

  try {
    const image = new Image();
    image.decoding = "async";
    image.src = objectUrl;

    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("画像を読み込めませんでした。JPGまたはPNGでお試しください。"));
    });

    const scale = Math.min(
      1,
      MAX_UPLOAD_IMAGE_DIMENSION / image.naturalWidth,
      MAX_UPLOAD_IMAGE_DIMENSION / image.naturalHeight,
    );
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("画像の軽量化に失敗しました。別のブラウザでお試しください。");
    }

    canvas.width = width;
    canvas.height = height;
    context.drawImage(image, 0, 0, width, height);

    const qualities = [0.86, 0.8, 0.74, 0.68, 0.62];
    let compressedBlob = await canvasToJpegBlob(canvas, qualities[0]);

    for (const quality of qualities.slice(1)) {
      if (compressedBlob.size <= TARGET_UPLOAD_SIZE_BYTES) {
        break;
      }

      compressedBlob = await canvasToJpegBlob(canvas, quality);
    }

    return blobToFile(compressedBlob, "room-image.jpg");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function getFriendlyErrorMessage(caughtError: unknown) {
  const message =
    caughtError instanceof Error
      ? caughtError.message
      : "画像生成に失敗しました。時間をおいて再度お試しください。";

  if (message.includes("The string did not match the expected pattern")) {
    return "スマホブラウザ側で画像送信に失敗しました。ページを再読み込みして、同じ画像をもう一度選択してから生成してください。続く場合は別のブラウザでお試しください。";
  }

  if (message.includes("Failed to fetch") || message.includes("NetworkError")) {
    return "通信に失敗しました。ネットワーク環境を確認し、ページを再読み込みしてからもう一度お試しください。";
  }

  if (message.includes("JSON Parse error") || message.includes("Unexpected identifier")) {
    return "サーバーから一時的に予期しない応答が返りました。画像生成が混み合っているか、処理時間が長くなっています。少し待ってからもう一度お試しください。";
  }

  return message;
}

function parseGenerateResponse(responseText: string) {
  if (!responseText) {
    return {};
  }

  try {
    return JSON.parse(responseText) as GeneratePayload;
  } catch {
    if (responseText.includes("Request Entity Too Large")) {
      return {
        error:
          "アップロード画像が大きすぎます。画像を少し小さくしてからもう一度お試しください。",
      };
    }

    if (responseText.includes("FUNCTION_INVOCATION_TIMEOUT")) {
      return {
        error:
          "画像生成の処理時間が長くなりタイムアウトしました。別の画像または短めの配置指示で再度お試しください。",
      };
    }

    return {
      error:
        "サーバーから予期しない応答が返りました。少し待ってからもう一度お試しください。",
    };
  }
}

export default function Home() {
  const [roomImage, setRoomImage] = useState<File | null>(null);
  const [selectedProductId, setSelectedProductId] = useState(SIEVE_PRODUCTS[0]?.id ?? "");
  const [placementInstruction, setPlacementInstruction] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [generatedImage, setGeneratedImage] = useState("");
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [remainingGenerations, setRemainingGenerations] = useState(GENERATION_LIMIT);
  const [quotaMode, setQuotaMode] = useState<QuotaMode>("local");
  const [isResetOpen, setIsResetOpen] = useState(false);
  const [resetCode, setResetCode] = useState("");
  const [resetMessage, setResetMessage] = useState("");

  const selectedProduct = useMemo(
    () => SIEVE_PRODUCTS.find((product) => product.id === selectedProductId) ?? SIEVE_PRODUCTS[0],
    [selectedProductId],
  );
  const groupedProducts = useMemo(
    () =>
      SIEVE_PRODUCT_CATEGORIES.map((category) => ({
        category,
        products: SIEVE_PRODUCTS.filter((product) => product.category === category),
      })).filter((group) => group.products.length > 0),
    [],
  );

  const isFull = remainingGenerations <= 0;

  const imageWarning = useMemo(() => {
    if (!roomImage) {
      return "";
    }

    if (roomImage.size > MAX_IMAGE_SIZE_BYTES) {
      return "画像サイズが大きすぎます。50MB未満の画像を選択してください。";
    }

    if (roomImage.size > WARNING_IMAGE_SIZE_BYTES) {
      return `画像サイズが${formatFileSize(roomImage.size)}あります。アップロードや生成に時間がかかる場合があります。`;
    }

    return "";
  }, [roomImage]);

  useEffect(() => {
    async function loadSharedQuota() {
      try {
        const response = await fetch(new URL("/api/quota", window.location.origin), {
          cache: "no-store",
        });
        const payload = (await response.json()) as {
          mode?: QuotaMode;
          remaining?: number | null;
        };

        if (response.ok && payload.mode === "shared" && typeof payload.remaining === "number") {
          setQuotaMode("shared");
          setRemainingGenerations(payload.remaining);
          return;
        }
      } catch {
        // Fallback to local quota when shared quota storage is not configured or unavailable.
      }

      setQuotaMode("local");
      const storedValue = window.localStorage.getItem(STORAGE_KEY);
      const parsedValue = storedValue === null ? GENERATION_LIMIT : Number(storedValue);
      const safeValue = Number.isFinite(parsedValue)
        ? Math.min(Math.max(parsedValue, 0), GENERATION_LIMIT)
        : GENERATION_LIMIT;

      setRemainingGenerations(safeValue);
    }

    loadSharedQuota();
  }, []);

  useEffect(() => {
    if (quotaMode !== "shared") {
      return;
    }

    async function refreshSharedQuota() {
      try {
        const response = await fetch(new URL("/api/quota", window.location.origin), {
          cache: "no-store",
        });
        const payload = (await response.json()) as { remaining?: number | null };

        if (response.ok && typeof payload.remaining === "number") {
          setRemainingGenerations(payload.remaining);
        }
      } catch {
        // Keep the last visible count if a background refresh fails.
      }
    }

    function handleVisibilityChange() {
      if (!document.hidden) {
        refreshSharedQuota();
      }
    }

    window.addEventListener("focus", refreshSharedQuota);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", refreshSharedQuota);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [quotaMode]);

  useEffect(() => {
    if (quotaMode === "shared") {
      return;
    }

    const storedValue = window.localStorage.getItem(STORAGE_KEY);
    const parsedValue = storedValue === null ? GENERATION_LIMIT : Number(storedValue);
    const safeValue = Number.isFinite(parsedValue)
      ? Math.min(Math.max(parsedValue, 0), GENERATION_LIMIT)
      : GENERATION_LIMIT;

    setRemainingGenerations(safeValue);
  }, [quotaMode]);

  useEffect(() => {
    if (!roomImage) {
      setPreviewUrl("");
      return;
    }

    const nextPreviewUrl = URL.createObjectURL(roomImage);
    setPreviewUrl(nextPreviewUrl);

    return () => URL.revokeObjectURL(nextPreviewUrl);
  }, [roomImage]);

  function updateRemainingGenerations(nextValue: number) {
    const safeValue = Math.min(Math.max(nextValue, 0), GENERATION_LIMIT);
    setRemainingGenerations(safeValue);

    if (quotaMode === "local") {
      window.localStorage.setItem(STORAGE_KEY, String(safeValue));
    }
  }

  async function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setGeneratedImage("");
    setError("");
    setStatusMessage("");

    if (!file) {
      setRoomImage(null);
      return;
    }

    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      setRoomImage(null);
      setError("画像サイズが大きすぎます。別の画像を選択してください。");
      return;
    }

    try {
      setStatusMessage("アップロード画像を生成用に軽量化しています。");
      const compressedFile = await compressImageForUpload(file);
      setRoomImage(compressedFile);

      if (compressedFile.size < file.size) {
        setStatusMessage(
          `アップロード画像を生成用に軽量化しました（${formatFileSize(file.size)} → ${formatFileSize(
            compressedFile.size,
          )}）。`,
        );
      }
    } catch (caughtError) {
      setRoomImage(null);
      setError(getFriendlyErrorMessage(caughtError));
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setStatusMessage("");
    setGeneratedImage("");

    if (isFull) {
      setError("利用回数が上限に達しています。");
      return;
    }

    if (!roomImage) {
      setError("部屋画像をアップロードしてください。");
      return;
    }

    if (roomImage.size > MAX_IMAGE_SIZE_BYTES) {
      setError("画像サイズが大きすぎます。50MB未満の画像を選択してください。");
      return;
    }

    if (!selectedProduct) {
      setError("SIEVE公式商品のリストから商品を選択してください。");
      return;
    }

    if (!placementInstruction.trim()) {
      setError("配置場所の説明を入力してください。");
      return;
    }

    const formData = new FormData();
    formData.append("roomImage", roomImage, `room-image.${getImageExtension(roomImage)}`);
    formData.append("productId", selectedProduct.id);
    formData.append("placementInstruction", placementInstruction.trim());

    setIsLoading(true);

    try {
      const response = await fetch(new URL("/api/generate", window.location.origin), {
        method: "POST",
        body: formData,
      });

      const responseText = await response.text();
      const payload = parseGenerateResponse(responseText);

      if (!response.ok) {
        throw new Error(payload.error || "画像生成に失敗しました。");
      }

      if (!payload.image) {
        throw new Error("生成画像を受け取れませんでした。もう一度お試しください。");
      }

      setGeneratedImage(payload.image);
      if (quotaMode === "shared" && typeof payload.remaining === "number") {
        setRemainingGenerations(payload.remaining);
      } else {
        updateRemainingGenerations(remainingGenerations - 1);
      }
      setStatusMessage("SIEVE商品のプレビュー画像を生成しました。");
    } catch (caughtError) {
      setError(getFriendlyErrorMessage(caughtError));
    } finally {
      setIsLoading(false);
    }
  }

  function handleResetSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (resetCode !== "19910114") {
      setResetMessage("認証に失敗しました");
      return;
    }

    // Beta-only local reset. For production, move reset authorization to a server-managed secret.
    if (quotaMode === "shared") {
      fetch(new URL("/api/quota", window.location.origin), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "reset",
          code: resetCode,
        }),
      })
        .then(async (response) => {
          const payload = (await response.json()) as {
            error?: string;
            remaining?: number | null;
          };

          if (!response.ok) {
            throw new Error(payload.error || "認証に失敗しました");
          }

          setRemainingGenerations(
            typeof payload.remaining === "number" ? payload.remaining : GENERATION_LIMIT,
          );
          setResetMessage("回数をリセットしました");
          setResetCode("");
        })
        .catch((caughtError) => setResetMessage(getFriendlyErrorMessage(caughtError)));
    } else {
      updateRemainingGenerations(GENERATION_LIMIT);
      setResetMessage("回数をリセットしました");
      setResetCode("");
    }
  }

  function openResetModal() {
    setIsResetOpen(true);
    setResetCode("");
    setResetMessage("");
  }

  return (
    <main className="min-h-screen bg-white px-4 py-6 text-[#333333] sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-10">
        <header className="border-b border-[#d8d8d8] pb-8">
          <div className="flex items-center justify-between gap-4 border-b border-[#eeeeee] pb-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#707070]">
              Official EC Preview
            </p>
            <a
              href="https://www.sieve.jp/shop/default.aspx"
              target="_blank"
              rel="noreferrer"
              className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#707070] underline-offset-4 hover:underline"
            >
              SIEVE Online Store
            </a>
          </div>
          <div className="pt-8">
            <h1 className="text-[32px] font-normal leading-tight tracking-[0.16em] text-[#555555] sm:text-[44px]">
              SIEVE ROOM PREVIEW
            </h1>
            <p className="mt-4 max-w-2xl text-sm font-medium leading-8 tracking-[0.08em] text-[#666666]">
              SIEVE公式サイト内のソファから商品を選び、部屋写真に自然に配置した購入検討用イメージを生成します。
            </p>
          </div>
        </header>

        <section className="grid gap-8 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <form
            onSubmit={handleSubmit}
            className="flex flex-col gap-6 border border-[#dcdcdc] bg-white p-5 sm:p-7"
          >
            <label className="flex flex-col gap-2">
              <span className="text-sm font-bold tracking-[0.08em] text-[#333333]">部屋画像アップロード</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
                onChange={handleImageChange}
                className="block w-full border border-[#cccccc] bg-white px-3 py-2 text-sm text-[#333333] transition hover:border-[#666666] file:mr-4 file:border-0 file:bg-[#333333] file:px-5 file:py-2.5 file:text-sm file:font-bold file:tracking-[0.08em] file:text-white hover:file:opacity-70"
              />
            </label>

            <div className="border border-[#dcdcdc] bg-[#f8f8f8] px-4 py-4 text-xs leading-6 tracking-[0.04em] text-[#666666]">
              <p className="font-bold text-[#333333]">きれいに生成するための撮影メモ</p>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                <li>家具が入る余裕ができるだけある写真を使ってください。</li>
                <li>部屋の小物などが少なく、シンプルな写真ほど精度が上がります。</li>
                <li>十分な明るさがある写真がおすすめです。</li>
                <li>できるだけ部屋を広めに写してください。</li>
                <li>実際の商品サイズに対して狭い場所を指定すると、形状や比率が変わりやすくなります。</li>
              </ul>
            </div>

            {imageWarning ? (
              <div className="border border-[#d8b36a] bg-[#fffaf0] px-4 py-3 text-sm leading-6 text-[#6f5521]">
                {imageWarning}
              </div>
            ) : null}

            <label className="flex flex-col gap-2">
              <span className="text-sm font-bold tracking-[0.08em] text-[#333333]">SIEVEソファ選択</span>
              <select
                value={selectedProductId}
                onChange={(event) => {
                  setSelectedProductId(event.target.value);
                  setGeneratedImage("");
                  setError("");
                  setStatusMessage("");
                }}
                className="h-12 border border-[#cccccc] bg-white px-3 text-base text-[#333333] outline-none transition hover:border-[#666666] focus:border-[#707070] focus:ring-4 focus:ring-[#88aeb7]/20"
              >
                {groupedProducts.map((group) => (
                  <optgroup key={group.category} label={group.category}>
                    {group.products.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>

            {selectedProduct ? (
              <div className="grid gap-4 border border-[#dcdcdc] bg-white p-4 sm:grid-cols-[116px_1fr]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={selectedProduct.imageUrl}
                  alt={selectedProduct.name}
                  className="aspect-square w-full border border-[#eeeeee] bg-[#f8f8f8] object-contain"
                />
                <div className="flex flex-col gap-2">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#557b83]">
                      {selectedProduct.category}
                    </p>
                    <p className="mt-1 text-sm font-bold leading-6 tracking-[0.04em] text-[#333333]">
                      {selectedProduct.name}
                    </p>
                  </div>
                  <p className="text-sm leading-7 tracking-[0.03em] text-[#666666]">{selectedProduct.description}</p>
                  <a
                    href={selectedProduct.productUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="w-fit text-sm font-bold tracking-[0.04em] text-[#557b83] underline-offset-4 hover:text-[#35545a] hover:underline"
                  >
                    SIEVE公式商品ページ
                  </a>
                </div>
              </div>
            ) : null}

            <label className="flex flex-col gap-2">
              <span className="text-sm font-bold tracking-[0.08em] text-[#333333]">配置場所の説明</span>
              <textarea
                value={placementInstruction}
                onChange={(event) => setPlacementInstruction(event.target.value)}
                placeholder="例: 右側の窓下の壁に背もたれをぴったり沿わせて、壁と平行に配置してください。斜めに置かないでください。"
                rows={5}
                className="resize-none border border-[#cccccc] px-4 py-4 text-base text-[#333333] outline-none transition placeholder:text-[#999999] hover:border-[#666666] focus:border-[#707070] focus:ring-4 focus:ring-[#88aeb7]/20"
              />
            </label>

            {error ? (
              <div className="border border-[#e3b9b9] bg-[#fbf0f0] px-4 py-3 text-sm leading-6 text-[#a94442]">
                {error}
              </div>
            ) : null}

            {statusMessage ? (
              <div className="border border-[#88aeb7] bg-[#f4f8f9] px-4 py-3 text-sm leading-6 text-[#35545a]">
                {statusMessage}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={isLoading || isFull}
              className="inline-flex h-12 items-center justify-center bg-[#333333] px-5 text-sm font-bold tracking-[0.16em] text-white transition hover:opacity-70 disabled:cursor-not-allowed disabled:bg-[#999999]"
            >
              {isLoading ? "生成中..." : isFull ? "full" : "生成ボタン"}
            </button>

            {isLoading ? (
              <div className="flex items-start gap-3 text-sm leading-6 text-[#666666]">
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#88aeb7]" />
                <div>
                  <p>SIEVE商品の形状と部屋の光、遠近感、影を合わせて配置しています。</p>
                  <p className="mt-1 text-xs tracking-[0.04em] text-[#888888]">
                    生成には1分ほどかかる場合があります。このままお待ちください。
                  </p>
                </div>
              </div>
            ) : null}
          </form>

          <div className="grid gap-6">
            <section className="border border-[#dcdcdc] bg-white p-5 sm:p-7">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-lg font-bold tracking-[0.08em] text-[#333333]">アップロード画像</h2>
                {roomImage ? (
                  <span className="text-xs font-medium text-[#777777]">
                    {formatFileSize(roomImage.size)}
                  </span>
                ) : null}
              </div>
              <div className="flex aspect-[4/3] items-center justify-center overflow-hidden border border-dashed border-[#c8c8c8] bg-[#f8f8f8]">
                {previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={previewUrl} alt="Uploaded room" className="h-full w-full object-contain" />
                ) : (
                  <p className="px-6 text-center text-sm leading-6 tracking-[0.04em] text-[#777777]">
                    部屋画像を選択するとここにプレビューが表示されます。
                  </p>
                )}
              </div>
            </section>

            <section className="border border-[#dcdcdc] bg-white p-5 sm:p-7">
              <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-lg font-bold tracking-[0.08em] text-[#333333]">生成結果画像</h2>
                {generatedImage ? (
                  <a
                    href={generatedImage}
                    download="sieve-room-preview.png"
                    className="inline-flex h-10 items-center justify-center border border-[#707070] px-4 text-xs font-bold tracking-[0.12em] text-[#333333] transition hover:opacity-70"
                  >
                    生成画像をダウンロード
                  </a>
                ) : null}
              </div>
              <div className="flex aspect-[4/3] items-center justify-center overflow-hidden border border-dashed border-[#c8c8c8] bg-[#f8f8f8]">
                {generatedImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={generatedImage}
                    alt="Generated SIEVE furniture placement"
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <p className="px-6 text-center text-sm leading-6 tracking-[0.04em] text-[#777777]">
                    生成後のSIEVEインテリア画像がここに表示されます。
                  </p>
                )}
              </div>
            </section>
          </div>
        </section>

        <div className="grid gap-3 border-t border-[#eeeeee] pb-8 pt-8 text-center">
          <p className="mx-auto max-w-2xl px-4 text-[11px] leading-6 tracking-[0.08em] text-[#9a9a9a]">
            生成画像は購入検討用のイメージです。再現度は70〜80%程度を目安としてご確認ください。実際の商品サイズ、設置可否、色味、形状、納まりを保証するものではありません。
          </p>
          <div className="flex items-center justify-center gap-3 text-[10px] font-medium tracking-[0.08em] text-[#d0d0d0]">
            <span>{isFull ? "full" : `${remainingGenerations} / ${GENERATION_LIMIT}`}</span>
            <button
              type="button"
              onClick={openResetModal}
              className="border border-[#eeeeee] px-1.5 py-0.5 text-[9px] tracking-[0.14em] text-[#c8c8c8] opacity-35 transition hover:opacity-70"
            >
              STAFF
            </button>
          </div>
        </div>
      </div>

      {isResetOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4">
          <div className="w-full max-w-sm border border-[#dcdcdc] bg-white p-5 shadow-soft">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold tracking-[0.08em] text-[#333333]">利用回数リセット</h2>
                <p className="mt-1 text-sm leading-6 text-[#666666]">
                  STAFFパスワードを入力してください。
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsResetOpen(false);
                }}
                className="px-2 py-1 text-sm font-bold text-[#666666] hover:bg-[#f8f8f8]"
              >
                閉じる
              </button>
            </div>

            <form onSubmit={handleResetSubmit} className="mt-5 grid gap-4">
              <label className="grid gap-2">
                <span className="text-sm font-bold tracking-[0.08em] text-[#333333]">パスワード</span>
                <input
                  type="password"
                  value={resetCode}
                  onChange={(event) => setResetCode(event.target.value)}
                  inputMode="numeric"
                  autoFocus
                  className="border border-[#cccccc] px-3 py-2 text-base outline-none hover:border-[#666666] focus:border-[#707070] focus:ring-4 focus:ring-[#88aeb7]/20"
                />
              </label>

              {resetMessage ? (
                <div
                  className={`px-4 py-3 text-sm leading-6 ${
                    resetMessage === "回数をリセットしました"
                      ? "border border-[#88aeb7] bg-[#f4f8f9] text-[#35545a]"
                      : "border border-red-200 bg-red-50 text-red-800"
                  }`}
                >
                  {resetMessage}
                </div>
              ) : null}

              <button
                type="submit"
                className="inline-flex h-11 items-center justify-center bg-[#333333] px-4 text-sm font-bold tracking-[0.12em] text-white hover:opacity-70"
              >
                リセット
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </main>
  );
}
