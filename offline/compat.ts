// Local, feature-detected runtime support for older Android System WebView.
// Build transforms handle syntax; they do not add missing built-in methods.
if (typeof Array.prototype.at !== "function") {
  Object.defineProperty(Array.prototype, "at", {
    configurable: true,
    writable: true,
    value: function at<T>(this: ArrayLike<T>, index: number = 0): T | undefined {
      if (this == null) throw new TypeError("Array.at called on null or undefined");
      const length = Math.min(Math.max(Math.trunc(Number(this.length)) || 0, 0), Number.MAX_SAFE_INTEGER);
      const numeric = +index;
      const offset = Number.isNaN(numeric) ? 0 : Math.trunc(numeric);
      const position = offset < 0 ? length + offset : offset;
      return position < 0 || position >= length ? undefined : this[position];
    },
  });
}

if (typeof String.prototype.replaceAll !== "function") {
  Object.defineProperty(String.prototype, "replaceAll", {
    configurable: true,
    writable: true,
    value: function replaceAll(this: string, search: string | RegExp, replacement: string | ((...args: unknown[]) => string)): string {
      if (this == null) throw new TypeError("String.replaceAll called on null or undefined");
      const text = String(this);
      if (search instanceof RegExp) {
        if (!search.global) throw new TypeError("replaceAll requires a global RegExp");
        return text.replace(search, replacement as string);
      }
      const literal = String(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return text.replace(new RegExp(literal, "g"), replacement as string);
    },
  });
}
