// Static assets resolved by Metro: the value is the asset id React Native and expo-image accept.
declare module '*.jpg' {
  const source: number;
  export default source;
}

declare module '*.png' {
  const source: number;
  export default source;
}

declare module '*.ttf' {
  const source: number;
  export default source;
}
