import { expect, test, type Page } from "@playwright/test";

import {
  openMockDm,
  openMockChannel,
  setupMockWorkspace,
  simulateVisualViewportHeight,
} from "./helpers/heroui-workspace";

type ChatScenario = {
  label: string;
  route: "channel" | "dm";
  channelId: string;
  textboxName: RegExp;
  width: number;
  height: number;
  visualViewportHeight: number;
};

const chatScenarios: ChatScenario[] = [
  {
    label: "channel at iPhone width",
    route: "channel",
    channelId: "ch-onboarding",
    textboxName: /Message onboarding/i,
    width: 390,
    height: 844,
    visualViewportHeight: 560,
  },
  {
    label: "DM at iPhone width",
    route: "dm",
    channelId: "dm-agent",
    textboxName: /Message Cloud Test Agent/i,
    width: 390,
    height: 844,
    visualViewportHeight: 560,
  },
  {
    label: "channel at 320px width",
    route: "channel",
    channelId: "ch-research",
    textboxName: /Message research/i,
    width: 320,
    height: 700,
    visualViewportHeight: 440,
  },
  {
    label: "DM at 320px width",
    route: "dm",
    channelId: "dm-agent",
    textboxName: /Message Cloud Test Agent/i,
    width: 320,
    height: 700,
    visualViewportHeight: 440,
  },
];

type ElementMetrics = {
  name: string;
  left: number;
  right: number;
  width: number;
};

type MobileChatMetrics = {
  viewportWidth: number;
  visualViewportHeight: number;
  footerBottom: number;
  footerTop: number;
  composerBottom: number;
  composerTop: number;
  textboxBottom: number;
  activeRole: string | null;
  activeAriaLabel: string | null;
  minTextControlFontSize: number;
  bodyScrollable: boolean;
  documentScrollable: boolean;
  bodyHorizontalOverflow: boolean;
  documentHorizontalOverflow: boolean;
  overflowingElements: ElementMetrics[];
};

async function readMobileChatMetrics(page: Page): Promise<MobileChatMetrics> {
  return page.evaluate(() => {
    const rectFor = (name: string, element: Element | null) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { name, left: rect.left, right: rect.right, width: rect.width };
    };

    const chatSurface = document.querySelector<HTMLElement>('[data-chat-surface="heroui-pro-template-chat"]');
    const header = document.querySelector<HTMLElement>('[aria-label="Conversation header"]');
    const messageRegion = chatSurface?.children.item(1) ?? null;
    const footer = document.querySelector<HTMLElement>('[data-testid="message-composer-footer"]');
    const composer = document.querySelector<HTMLElement>('[data-testid="message-composer"]');
    const composerInput = document.querySelector<HTMLElement>('[data-testid="message-composer-input"]');
    const textbox = document.querySelector<HTMLElement>('[data-testid="message-composer-input"] [role="textbox"]');
    const active = document.activeElement as HTMLElement | null;

    const fontSizes = Array.from(document.querySelectorAll<HTMLElement>(
      '[data-testid="message-composer-input"] [role="textbox"], [data-testid="message-composer-input"] textarea',
    )).map((element) => Number.parseFloat(getComputedStyle(element).fontSize));

    const viewportWidth = window.innerWidth;
    const checkedElements = [
      rectFor("chat surface", chatSurface),
      rectFor("conversation header", header),
      rectFor("message region", messageRegion),
      rectFor("composer footer", footer),
      rectFor("composer", composer),
      rectFor("composer input", composerInput),
      rectFor("textbox", textbox),
    ].filter((value): value is ElementMetrics => Boolean(value));

    return {
      viewportWidth,
      visualViewportHeight: Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--raltic-visual-viewport-height"),
      ),
      footerBottom: footer?.getBoundingClientRect().bottom ?? 0,
      footerTop: footer?.getBoundingClientRect().top ?? 0,
      composerBottom: composer?.getBoundingClientRect().bottom ?? 0,
      composerTop: composer?.getBoundingClientRect().top ?? 0,
      textboxBottom: textbox?.getBoundingClientRect().bottom ?? 0,
      activeRole: active?.getAttribute("role") ?? null,
      activeAriaLabel: active?.getAttribute("aria-label") ?? null,
      minTextControlFontSize: fontSizes.length > 0 ? Math.min(...fontSizes) : 0,
      bodyScrollable: document.body.scrollHeight > document.body.clientHeight + 1,
      documentScrollable: document.documentElement.scrollHeight > document.documentElement.clientHeight + 1,
      bodyHorizontalOverflow: document.body.scrollWidth > document.body.clientWidth + 1,
      documentHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      overflowingElements: checkedElements.filter((rect) => rect.left < -1 || rect.right > viewportWidth + 1),
    };
  });
}

async function openMobileChat(page: Page, context: Parameters<typeof setupMockWorkspace>[1], scenario: ChatScenario) {
  await page.setViewportSize({ width: scenario.width, height: scenario.height });
  await setupMockWorkspace(page, context);
  if (scenario.route === "dm") {
    await openMockDm(page, scenario.channelId);
  } else {
    await openMockChannel(page, scenario.channelId);
  }
}

test.describe("HeroUI Pro mobile chat composer", () => {
  for (const scenario of chatScenarios) {
    test(`${scenario.label} keeps focused composer docked above the visual viewport`, async ({ page, context }) => {
      await openMobileChat(page, context, scenario);

      const textbox = page.getByRole("textbox", { name: scenario.textboxName });
      await expect(textbox).toBeVisible();
      await textbox.focus();
      await expect(textbox).toBeFocused();

      await simulateVisualViewportHeight(page, scenario.visualViewportHeight);
      await page.waitForFunction((limit) => {
        const footer = document.querySelector<HTMLElement>('[data-testid="message-composer-footer"]');
        const composer = document.querySelector<HTMLElement>('[data-testid="message-composer"]');
        return Boolean(
          footer &&
          composer &&
          footer.getBoundingClientRect().bottom <= limit + 1 &&
          composer.getBoundingClientRect().bottom <= limit + 1,
        );
      }, scenario.visualViewportHeight);

      const metrics = await readMobileChatMetrics(page);

      expect(metrics.activeRole).toBe("textbox");
      expect(metrics.activeAriaLabel).toMatch(scenario.textboxName);
      expect(metrics.minTextControlFontSize).toBeGreaterThanOrEqual(16);
      expect(metrics.visualViewportHeight).toBe(scenario.visualViewportHeight);
      expect(metrics.footerBottom).toBeLessThanOrEqual(scenario.visualViewportHeight + 1);
      expect(metrics.footerBottom).toBeGreaterThanOrEqual(scenario.visualViewportHeight - 48);
      expect(metrics.composerBottom).toBeLessThanOrEqual(scenario.visualViewportHeight + 1);
      expect(metrics.textboxBottom).toBeLessThanOrEqual(scenario.visualViewportHeight + 1);
      expect(metrics.bodyScrollable).toBe(false);
      expect(metrics.documentScrollable).toBe(false);
    });

    test(`${scenario.label} keeps header, messages, and composer inside the mobile viewport`, async ({ page, context }) => {
      await openMobileChat(page, context, scenario);
      await page.getByRole("textbox", { name: scenario.textboxName }).focus();
      await simulateVisualViewportHeight(page, scenario.visualViewportHeight);

      const metrics = await readMobileChatMetrics(page);

      expect(metrics.bodyHorizontalOverflow).toBe(false);
      expect(metrics.documentHorizontalOverflow).toBe(false);
      expect(metrics.overflowingElements).toEqual([]);
      expect(metrics.composerTop).toBeGreaterThanOrEqual(metrics.footerTop - 1);
      expect(metrics.composerTop).toBeGreaterThanOrEqual(0);
      expect(metrics.composerBottom).toBeLessThanOrEqual(scenario.visualViewportHeight + 1);
    });
  }
});
