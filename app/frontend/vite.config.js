import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// import vitePluginImp from "vite-plugin-imp";
import path from "path";

export default defineConfig({
  server: {
    sourcemap: true,
    proxy: {
      "/dev-api": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
        rewrite: (pathValue) => pathValue.replace(/^\/dev-api/, "/api")
      }
    }
  },
  plugins: [react()],
  css: {
    modules: {
      localsConvention: "camelCaseOnly"
    },
    preprocessorOptions: {
      less: {
        javascriptEnabled: true,
        modifyVars: {
          "@primary-color": "#1890ff" // 自定义主题色
        }
      }
    }
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@app": path.resolve(__dirname, "src/app"),
      "@util": path.resolve(__dirname, "src/util"),
      "@constant": path.resolve(__dirname, "src/constant"),
      "@component": path.resolve(__dirname, "src/component"),
      "@state": path.resolve(__dirname, "src/state")
    }
  },
  build: {
    rollupOptions: {
      output: {
        // 1. 配置JS文件（入口文件和代码分割块）都输出到 js 目录
        entryFileNames: "js/[name]-[hash].js",
        chunkFileNames: "js/[name]-[hash].js",

        // 2. 配置非JS资源（CSS、图片等），使用函数进行细分
        assetFileNames: (assetInfo) => {
          const fileName = assetInfo.name || "";

          // 将CSS文件输出到 css 目录
          if (fileName.endsWith(".css")) {
            return "css/[name]-[hash][extname]";
          }

          // 定义图片类型，输出到 images 目录
          const imgExts = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"];
          if (imgExts.some((ext) => fileName.endsWith(ext))) {
            return "images/[name]-[hash][extname]";
          }

          // 其他资源类型，例如字体文件
          const fontExts = [".woff", ".woff2", ".ttf", ".eot"];
          if (fontExts.some((ext) => fileName.endsWith(ext))) {
            return "fonts/[name]-[hash][extname]";
          }

          // 其他未匹配的资源默认放到 assets 目录
          return "assets/[name]-[hash][extname]";
        }
      }
    }
  }
});
