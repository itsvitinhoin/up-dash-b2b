/// <reference lib="dom" />
import type { Browser } from "puppeteer-core";
import { z } from "zod";
import {
  AIYU_STORE_ID,
  cartSchema,
  formatFreight,
  readShippingSnapshot,
  storefrontRequest,
  StorefrontError,
  type ShippingSnapshot,
} from "./up-manager-storefront";

const shopHosts = new Set(["www.aiyuoficial.com.br", "aiyuoficial.com.br"]);
const checkoutPath = /^\/checkout(?:\/|$)/;
const checkoutResources = new Set([
  "checkout-front.tiendanube.com",
  "checkout-api.ms.tiendanube.com",
  "services-checkout.tiendanube.com",
  "nsk-cdn-static.tiendanube.com",
  "wallet.tiendanube.com",
  "d1a9qnv764bsoo.cloudfront.net",
]);

const stages = ["Variante", "Carrinho", "Frete e subtotal", "Entrada do checkout"] as const;
type Stage = typeof stages[number];
type State = "passed" | "failed" | "inconclusive" | "not-run";
type Step = { label: Stage; status: State; detail?: string };

export type CheckoutTestResult = {
  testedAt: string;
  product: string;
  status: "passed" | "failed" | "inconclusive";
  steps: Step[];
  shipping?: ShippingSnapshot;
};

export type StorefrontVariant = {
  storeId: string;
  productId: string;
  variantId: string;
  name: string;
};

function validCheckoutLink(url: URL) {
  return url.protocol === "https:" && !url.port && !url.username && !url.password &&
    shopHosts.has(url.hostname) && checkoutPath.test(url.pathname);
}

async function openHostedCheckout(url: URL): Promise<Pick<Step, "status" | "detail">> {
  if (!validCheckoutLink(url)) return { status: "inconclusive", detail: "O endereço do checkout não corresponde à loja do piloto." };
  let browser: Browser | undefined;
  try {
    const [{ default: puppeteer }, { default: chromium }] = await Promise.all([
      import("puppeteer-core"),
      import("@sparticuz/chromium"),
    ]);
    const executable = process.env.UP_MANAGER_CHECKOUT_CHROME_PATH;
    browser = await puppeteer.launch({
      executablePath: executable || await chromium.executablePath(),
      headless: executable ? true : "shell",
      args: executable ? [] : chromium.args,
      timeout: 12_000,
      defaultViewport: { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
    });
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const target = new URL(request.url());
      const isPage = request.isNavigationRequest();
      const read = ["GET", "HEAD", "OPTIONS"].includes(request.method());
      const allowed = target.protocol === "https:" && read &&
        (isPage ? validCheckoutLink(target)
          : (shopHosts.has(target.hostname) || checkoutResources.has(target.hostname)) &&
            !/analytics|pixel|telemetry|beacon|\/stats\/record_visit|\/logger(?:\/|$)/i.test(target.pathname));
      void (allowed ? request.continue() : request.abort()).catch(() => undefined);
    });
    const response = await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 15_000 });
    if (!response?.ok()) {
      return { status: "inconclusive", detail: "A página do checkout não respondeu à sessão de teste." };
    }
    const contact = await page.waitForSelector(
      'input[name="contact.email"], input[type=email], input[autocomplete=email]',
      { visible: true, timeout: 18_000 },
    ).catch(() => null);
    if (contact) {
      return { status: "passed", detail: "A primeira tela de dados pessoais abriu na sessão móvel." };
    }
    const hasError = await page.evaluate(() =>
      /aconteceu algo inesperado|algo deu errado/i.test(document.querySelector("h1")?.textContent ?? ""),
    );
    return {
      status: "inconclusive",
      detail: hasError
        ? "O endereço do checkout abriu, mas a interface exibiu uma mensagem de erro na sessão de teste."
        : "A página respondeu com HTTP 200. Os campos da primeira tela ainda não foram confirmados na sessão.",
    };
  } catch {
    return { status: "inconclusive", detail: "A sessão móvel não conseguiu confirmar a primeira tela do checkout." };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

export async function testStorefrontCheckout(variant: StorefrontVariant): Promise<CheckoutTestResult> {
  const steps: Step[] = stages.map((label) => ({ label, status: "not-run" }));
  const storeId = variant.storeId;
  const variantId = Number(variant.variantId);
  const productId = Number(variant.productId);
  if (storeId !== AIYU_STORE_ID || !Number.isSafeInteger(variantId) || !Number.isSafeInteger(productId) ||
    variantId <= 0 || productId <= 0) throw new Error("Variante inválida para o piloto.");

  Object.assign(steps[0], { status: "passed", detail: "A Nuvemshop confirmou o produto e a variante do diagnóstico." });
  const shippingWork = readShippingSnapshot(storeId, variantId);
  let cart: ReturnType<typeof cartSchema.parse>["cart"] | undefined;
  try {
    const created = cartSchema.parse(await storefrontRequest(storeId, "/carts")).cart;
    const added = cartSchema.parse(await storefrontRequest(storeId, `/carts/${encodeURIComponent(created.id)}/line-items`, {
      product_id: productId, variant_id: variantId, quantity: 1,
    })).cart;
    if (added.id !== created.id || !added.line_items.some((line) =>
      line.variant_id === variantId && line.product_id === productId && line.quantity === 1)) {
      throw new Error("Variante não confirmada no carrinho.");
    }
    cart = added;
    Object.assign(steps[1], { status: "passed", detail: `Uma unidade confirmada no carrinho oficial da Nuvemshop. Subtotal de ${formatFreight(cart.cost.subtotal)}.` });
  } catch (error) {
    Object.assign(steps[1], {
      status: "inconclusive",
      detail: error instanceof StorefrontError
        ? `A API oficial respondeu com HTTP ${error.status} ao preparar o carrinho.`
        : "A API oficial não confirmou a variante no carrinho.",
    });
  }

  const shipping = await shippingWork;
  const covered = shipping.routes.filter(({ options }) => options !== null).length;
  const available = shipping.routes.filter(({ options }) => options?.length).length;
  Object.assign(steps[2], {
    status: covered === shipping.routes.length && available === covered ? "passed" : "inconclusive",
    detail: `Cotação confirmada em ${covered} de ${shipping.routes.length} CEPs. ${available} CEPs têm ao menos uma modalidade disponível.`,
  });

  if (cart) {
    try {
      const generated = z.object({ checkout_url: z.string().url() }).parse(
        await storefrontRequest(storeId, `/carts/${encodeURIComponent(cart.id)}/checkout`),
      );
      Object.assign(steps[3], await openHostedCheckout(new URL(generated.checkout_url)));
    } catch (error) {
      Object.assign(steps[3], {
        status: "inconclusive",
        detail: error instanceof StorefrontError
          ? `A API respondeu com HTTP ${error.status} ao abrir o checkout.`
          : "A API não retornou um endereço válido para o checkout.",
      });
    }
  }
  return {
    testedAt: new Date().toISOString(), product: variant.name, shipping, steps,
    status: steps.every(({ status }) => status === "passed") ? "passed" : "inconclusive",
  };
}
