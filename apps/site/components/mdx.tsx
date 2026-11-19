import { ImageZoom, type ImageZoomProps } from 'fumadocs-ui/components/image-zoom';
import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';

export function getMDXComponents(components?: MDXComponents) {
    return {
        ...defaultMdxComponents,
        // Every picture opens full size on click: the diagram has small labels.
        img: (props) => <ImageZoom {...(props as ImageZoomProps)} />,
        ...components,
    } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
    type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
