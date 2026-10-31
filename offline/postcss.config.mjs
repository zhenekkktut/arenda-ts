import tailwindcss from "@tailwindcss/postcss";
import cascadeLayers from "@csstools/postcss-cascade-layers";

// Tailwind first resolves the complete app.css import tree. Cascade layers must
// then be processed together to preserve normal and !important priority.
export default {
  plugins: [tailwindcss(), cascadeLayers()],
};
