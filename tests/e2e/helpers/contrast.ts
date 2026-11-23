import type { Locator } from '@playwright/test';

/**
 * WCAG AA's contrast for text below large scale, which is under 18pt (24px),
 * or under 14pt (about 18.7px) when bold: the pages' small labels are 11–13px.
 */
export const AA_TEXT_CONTRAST = 4.5;

/**
 * The WCAG 2 contrast ratio of an element's text against what is painted
 * behind it: its colour over the background colours of it and its
 * ancestors, laid one on another over white the way the browser paints
 * them. A 1×1 canvas does the blending, so a colour the stylesheet mixes
 * (color-mix(), oklab) counts as drawn, and a tint's transparency counts
 * too. Background images, opacity and anything positioned over the element
 * aren't counted: it is for text on plain backgrounds, which is all the
 * pages put it on.
 */
export async function textContrast(text: Locator): Promise<number> {
    return text.evaluate((element) => {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('No 2D canvas to blend colours on');
        /** Paints a colour over what is there; one the canvas can't read would leave the last colour, so that throws. */
        const paint = (color: string) => {
            const read = (sentinel: string) => {
                context.fillStyle = sentinel;
                context.fillStyle = color;
                return context.fillStyle;
            };
            if (read('#010203') !== read('#fdfcfb')) throw new Error(`The canvas can't paint ${color}`);
            context.fillRect(0, 0, 1, 1);
            const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
            return [r, g, b];
        };
        const luminance = ([r, g, b]: number[]) => {
            const linear = (v: number) => {
                const c = v / 255;
                return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
            };
            return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
        };

        const layers: string[] = [];
        for (let node: Element | null = element; node; node = node.parentElement) layers.unshift(getComputedStyle(node).backgroundColor);
        let background = paint('#ffffff');
        for (const layer of layers) background = paint(layer);
        const foreground = paint(getComputedStyle(element).color);
        const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
        return (lighter + 0.05) / (darker + 0.05);
    });
}
