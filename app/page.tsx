"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { SIEVE_PRODUCT_CATEGORIES, SIEVE_PRODUCTS } from "@/lib/sieveProducts";

const WARNING_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_SIZE_BYTES = 50 * 1024 * 1024;
const GENERATION_LIMIT = 100;
const STORAGE_KEY = "sieve-room-preview-remaining-generations";

function formatFileSize(bytes: number) {
  const mb = bytes / 1024 / 1024;
  return `${mb.toFixed(mb >= 10 ? 0 : 1)}MB`;
}

function getImageExtension(file: File) {
  if (file.type === "image/png") {
    return "png";
  }

  if (file.type === "image/webp") {
    return "webp";
  }

  return "jpg";
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

  return message;
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
  const [isResetOpen, setIsResetOpen] = useState(false);
  const [resetCode, setResetCode] = useState("");
  const [resetWord, setResetWord] = useState("");
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
    const storedValue = window.localStorage.getItem(STORAGE_KEY);
    const parsedValue = storedValue === null ? GENERATION_LIMIT : Number(storedValue);
    const safeValue = Number.isFinite(parsedValue)
      ? Math.min(Math.max(parsedValue, 0), GENERATION_LIMIT)
      : GENERATION_LIMIT;

    setRemainingGenerations(safeValue);
  }, []);

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
    window.localStorage.setItem(STORAGE_KEY, String(safeValue));
  }

  function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setRoomImage(file);
    setGeneratedImage("");
    setError("");
    setStatusMessage("");
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
      const payload = responseText
        ? (JSON.parse(responseText) as { image?: string; error?: string })
        : {};

      if (!response.ok) {
        throw new Error(payload.error || "画像生成に失敗しました。");
      }

      if (!payload.image) {
        throw new Error("生成画像を受け取れませんでした。もう一度お試しください。");
      }

      setGeneratedImage(payload.image);
      updateRemainingGenerations(remainingGenerations - 1);
      setStatusMessage("SIEVE商品のプレビュー画像を生成しました。");
    } catch (caughtError) {
      setError(getFriendlyErrorMessage(caughtError));
    } finally {
      setIsLoading(false);
    }
  }

  function handleResetSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (resetCode === "19910114" && resetWord === "SIEVERS") {
      // Beta-only local reset. For production, move quota tracking and reset authorization to the server.
      updateRemainingGenerations(GENERATION_LIMIT);
      setResetMessage("回数をリセットしました");
      setResetCode("");
      setResetWord("");
      return;
    }

    setResetMessage("認証に失敗しました");
  }

  return (
    <main className="min-h-screen px-4 py-8 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <header className="flex flex-col gap-3">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-700">
            SIEVE official EC preview
          </p>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-4xl font-semibold leading-tight text-slate-950 sm:text-5xl">
                SIEVE Room Preview
              </h1>
              <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">
                SIEVE公式サイト内のソファから商品を選び、部屋写真に自然に配置した購入検討用イメージを生成します。
              </p>
            </div>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <form
            onSubmit={handleSubmit}
            className="flex flex-col gap-5 rounded-lg border border-slate-200 bg-white p-5 shadow-soft"
          >
            <label className="flex flex-col gap-2">
              <span className="text-sm font-semibold text-slate-800">部屋画像アップロード</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleImageChange}
                className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm file:mr-4 file:rounded-md file:border-0 file:bg-slate-950 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-slate-800"
              />
            </label>

            {imageWarning ? (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
                {imageWarning}
              </div>
            ) : null}

            <label className="flex flex-col gap-2">
              <span className="text-sm font-semibold text-slate-800">SIEVEソファ選択</span>
              <select
                value={selectedProductId}
                onChange={(event) => {
                  setSelectedProductId(event.target.value);
                  setGeneratedImage("");
                  setError("");
                  setStatusMessage("");
                }}
                className="rounded-md border border-slate-300 bg-white px-3 py-3 text-base outline-none transition focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100"
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
              <div className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 sm:grid-cols-[112px_1fr]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={selectedProduct.imageUrl}
                  alt={selectedProduct.name}
                  className="aspect-square w-full rounded-md border border-slate-200 bg-white object-contain"
                />
                <div className="flex flex-col gap-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700">
                      {selectedProduct.category}
                    </p>
                    <p className="mt-1 text-sm font-semibold leading-6 text-slate-900">
                      {selectedProduct.name}
                    </p>
                  </div>
                  <p className="text-sm leading-6 text-slate-600">{selectedProduct.description}</p>
                  <a
                    href={selectedProduct.productUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-semibold text-emerald-700 hover:text-emerald-900"
                  >
                    SIEVE公式商品ページ
                  </a>
                </div>
              </div>
            ) : null}

            <label className="flex flex-col gap-2">
              <span className="text-sm font-semibold text-slate-800">配置場所の説明</span>
              <textarea
                value={placementInstruction}
                onChange={(event) => setPlacementInstruction(event.target.value)}
                placeholder="例: 窓の右側、ラグの上に壁と平行に配置"
                rows={5}
                className="resize-none rounded-md border border-slate-300 px-3 py-3 text-base outline-none transition focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100"
              />
            </label>

            {error ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-800">
                {error}
              </div>
            ) : null}

            {statusMessage ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-900">
                {statusMessage}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={isLoading || isFull}
              className="inline-flex h-12 items-center justify-center rounded-md bg-emerald-700 px-5 text-base font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {isLoading ? "生成中..." : isFull ? "full" : "生成ボタン"}
            </button>

            {isLoading ? (
              <div className="flex items-center gap-3 text-sm text-slate-600">
                <span className="h-3 w-3 animate-pulse rounded-full bg-emerald-600" />
                SIEVE商品の形状と部屋の光、遠近感、影を合わせて配置しています。
              </div>
            ) : null}
          </form>

          <div className="grid gap-6">
            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-slate-900">アップロード画像</h2>
                {roomImage ? (
                  <span className="text-xs font-medium text-slate-500">
                    {formatFileSize(roomImage.size)}
                  </span>
                ) : null}
              </div>
              <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-md border border-dashed border-slate-300 bg-slate-50">
                {previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={previewUrl} alt="Uploaded room" className="h-full w-full object-contain" />
                ) : (
                  <p className="px-6 text-center text-sm leading-6 text-slate-500">
                    部屋画像を選択するとここにプレビューが表示されます。
                  </p>
                )}
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
              <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-lg font-semibold text-slate-900">生成結果画像</h2>
                {generatedImage ? (
                  <a
                    href={generatedImage}
                    download="sieve-room-preview.png"
                    className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
                  >
                    生成画像をダウンロード
                  </a>
                ) : null}
              </div>
              <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-md border border-dashed border-slate-300 bg-slate-50">
                {generatedImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={generatedImage}
                    alt="Generated SIEVE furniture placement"
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <p className="px-6 text-center text-sm leading-6 text-slate-500">
                    生成後のSIEVEインテリア画像がここに表示されます。
                  </p>
                )}
              </div>
            </section>
          </div>
        </section>

        <div className="pb-8 text-center text-[10px] font-medium text-slate-300">
          {isFull ? "full" : `${remainingGenerations} / ${GENERATION_LIMIT}`}
        </div>
      </div>

      <button
        type="button"
        onClick={() => {
          setIsResetOpen(true);
          setResetMessage("");
        }}
        className="fixed bottom-3 right-3 z-40 h-7 w-7 rounded-full border border-slate-300 bg-white text-xs text-slate-700 opacity-25 shadow-sm transition hover:opacity-70"
        aria-label="Reset usage count"
      >
        .
      </button>

      {isResetOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4">
          <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">利用回数リセット</h2>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  β版の簡易認証です。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsResetOpen(false)}
                className="rounded-md px-2 py-1 text-sm font-semibold text-slate-500 hover:bg-slate-100"
              >
                閉じる
              </button>
            </div>

            <form onSubmit={handleResetSubmit} className="mt-5 grid gap-4">
              <label className="grid gap-2">
                <span className="text-sm font-semibold text-slate-800">認証コード</span>
                <input
                  value={resetCode}
                  onChange={(event) => setResetCode(event.target.value)}
                  className="rounded-md border border-slate-300 px-3 py-2 text-base outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100"
                />
              </label>

              <label className="grid gap-2">
                <span className="text-sm font-semibold text-slate-800">認証ワード</span>
                <input
                  value={resetWord}
                  onChange={(event) => setResetWord(event.target.value)}
                  className="rounded-md border border-slate-300 px-3 py-2 text-base outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100"
                />
              </label>

              {resetMessage ? (
                <div
                  className={`rounded-md px-4 py-3 text-sm leading-6 ${
                    resetMessage === "回数をリセットしました"
                      ? "border border-emerald-200 bg-emerald-50 text-emerald-900"
                      : "border border-red-200 bg-red-50 text-red-800"
                  }`}
                >
                  {resetMessage}
                </div>
              ) : null}

              <button
                type="submit"
                className="inline-flex h-11 items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800"
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
