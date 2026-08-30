/** @type {import('tailwindcss').Config} */
// TÁI CẤU TRÚC: chuyển Tailwind từ CDN (cdn.tailwindcss.com) sang build-time.
// Toàn bộ theme dưới đây được copy NGUYÊN VĂN từ khối `tailwind.config` nội tuyến
// trong index.html trước đây — hành vi class giữ nguyên 100%.
// Thêm plugin tailwindcss-animate: các class animate-in/fade-in/slide-in-from-*
// đã được dùng rải rác trong component (ToastContainer, modal...) từ trước nhưng
// CDN không kèm plugin nên chúng từng là no-op — giờ mới thực sự có hiệu lực.
import animate from 'tailwindcss-animate';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  plugins: [animate],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        display: ['Outfit', 'sans-serif'],
        serif: ['Merriweather', 'Lora', 'serif'],
        content: ['Lora', 'serif'],
      },
      // Typography phụ trợ: line-height rộng hơn cho vùng đọc chương
      // truyện dài (font-content), letter-spacing âm nhẹ cho heading
      // (font-display) để chữ to trông sắc nét, chuyên nghiệp hơn.
      lineHeight: {
        'reading': '1.85',
      },
      letterSpacing: {
        'heading': '-0.015em',
      },
      colors: {
        sky: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
        },
        slate: {
          850: '#1e293b', // Custom dark slate
          900: '#0f172a',
          950: '#020617', // Deepest slate
        },
        // Zen Dark Mode Colors
        zen: {
          bg: '#050505',
          card: '#0a0a0a',
          border: '#1a1a1a',
          text: '#e5e5e5',
          muted: '#a3a3a3'
        },
        // === DESIGN TOKENS ===
        // Alias ngữ nghĩa cho màu accent chính, dùng thay cho "indigo" rải rác
        // để sau này đổi thương hiệu chỉ cần sửa 1 chỗ.
        primary: {
          50: '#eef2ff', 100: '#e0e7ff', 200: '#c7d2fe', 300: '#a5b4fc',
          400: '#818cf8', 500: '#6366f1', 600: '#4f46e5', 700: '#4338ca',
          800: '#3730a3', 900: '#312e81',
        },
        // Màu ngữ nghĩa trạng thái — map theo đúng tông đang dùng
        // (emerald=success, amber=warning, rose=danger, sky=info).
        success: {
          50: '#ecfdf5', 100: '#d1fae5', 400: '#34d399', 500: '#10b981',
          600: '#059669', 900: '#064e3b',
        },
        warning: {
          50: '#fffbeb', 100: '#fef3c7', 400: '#fbbf24', 500: '#f59e0b',
          600: '#d97706', 900: '#78350f',
        },
        danger: {
          50: '#fff1f2', 100: '#ffe4e6', 400: '#fb7185', 500: '#f43f5e',
          600: '#e11d48', 900: '#4c0519',
        },
        info: {
          50: '#f0f9ff', 100: '#e0f2fe', 400: '#38bdf8', 500: '#0ea5e9',
          600: '#0284c7', 900: '#0c4a6e',
        },
      },
      // Thang elevation thống nhất.
      boxShadow: {
        'elevation-1': '0 1px 2px 0 rgba(15, 23, 42, 0.04)',
        'elevation-2': '0 2px 8px -2px rgba(15, 23, 42, 0.08), 0 1px 2px -1px rgba(15, 23, 42, 0.06)',
        'elevation-3': '0 8px 20px -4px rgba(15, 23, 42, 0.12), 0 2px 6px -2px rgba(15, 23, 42, 0.08)',
        'elevation-4': '0 16px 32px -8px rgba(15, 23, 42, 0.18)',
        'elevation-5': '0 24px 48px -12px rgba(15, 23, 42, 0.28)',
        'glow-primary': '0 0 0 1px rgba(99, 102, 241, 0.15), 0 4px 16px -2px rgba(99, 102, 241, 0.25)',
      },
      transitionTimingFunction: {
        'smooth': 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
      animation: {
        'blob': 'blob 7s infinite',
      },
      keyframes: {
        blob: {
          '0%': { transform: 'translate(0px, 0px) scale(1)' },
          '33%': { transform: 'translate(30px, -50px) scale(1.1)' },
          '66%': { transform: 'translate(-20px, 20px) scale(0.9)' },
          '100%': { transform: 'translate(0px, 0px) scale(1)' },
        }
      }
    }
  }
}
