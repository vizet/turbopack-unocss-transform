import type {NextConfig} from "next"
export type WithUnoTransformOptions = Partial<NextConfig>
export default function withUnoTransform(options?: WithUnoTransformOptions): NextConfig
