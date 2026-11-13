# ==============================================================================
# MODULE AI TẠO ẢNH MINH HỌA TỪ VỰNG VÀ KHÁI NIỆM (CHALKBOARD SKETCH)
# (TASK TF2850F) - Phụ trách: Nguyễn Ngọc Gia Bảo (AI / Backend)
# ==============================================================================

import base64
import logging
import re
from typing import Dict, Any, Optional, List

from app.schemas.canvas import ChalkIllustrationData, IllustrationResponse
from app.core.config import settings

logger = logging.getLogger(__name__)


# ------------------------------------------------------------------------------
# KHO THƯ VIỆN NÉT VẼ PHẤN TRẮNG (CHALKBOARD VECTOR ART LIBRARY)
# Thiết kế chuẩn phong cách bảng đen phấn trắng (Chalkboard Sketch) cho
# giáo viên môn Tiếng Anh, Sinh học và Địa lý.
# ------------------------------------------------------------------------------

def _svg_wrap(inner_content: str, width: int = 320, height: int = 240, title: str = "") -> str:
    """Bọc nội dung vector thành thẻ SVG hoàn chỉnh với hiệu ứng phấn vẽ học đường."""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" '
        f'width="{width}" height="{height}" style="background:transparent;overflow:visible;">'
        f'<defs>'
        f'  <filter id="chalk-glow" x="-20%" y="-20%" width="140%" height="140%">'
        f'    <feGaussianBlur stdDeviation="0.8" result="blur" />'
        f'    <feMerge>'
        f'      <feMergeNode in="blur" />'
        f'      <feMergeNode in="SourceGraphic" />'
        f'    </feMerge>'
        f'  </filter>'
        f'</defs>'
        f'<g filter="url(#chalk-glow)" stroke="#f8fafc" stroke-width="2.5" '
        f'stroke-linecap="round" stroke-linejoin="round" fill="none">'
        f'{inner_content}'
        f'</g>'
        f'</svg>'
    )


CHALK_TEMPLATES: Dict[str, Dict[str, Any]] = {
    # --------------------------------------------------------------------------
    # 1. KHÁI NIỆM SINH HỌC (BIOLOGY)
    # --------------------------------------------------------------------------
    "photosynthesis": {
        "title": "Quá trình Quang hợp (Photosynthesis)",
        "subject": "SINH_HOC",
        "caption": "Minh họa quá trình quang hợp ở cây xanh",
        "description": "Cây xanh hấp thụ ánh sáng mặt trời, khí CO₂ và nước (H₂O) từ rễ để tổng hợp chất hữu cơ (Glucose) và giải phóng Oxy (O₂).",
        "tags": ["photosynthesis", "quang hop", "sinh hoc", "biology", "cay xanh", "la cay"],
        "svg_inner": """
            <!-- Mặt trời & Ánh sáng -->
            <circle cx="50" cy="50" r="22" stroke="#fef08a" stroke-dasharray="3,2" />
            <line x1="50" y1="18" x2="50" y2="8" stroke="#fef08a" />
            <line x1="74" y1="26" x2="82" y2="18" stroke="#fef08a" />
            <line x1="82" y1="50" x2="92" y2="50" stroke="#fef08a" />
            <line x1="74" y1="74" x2="82" y2="82" stroke="#fef08a" />
            <line x1="50" y1="82" x2="50" y2="92" stroke="#fef08a" />
            <!-- Tia nắng tới lá -->
            <path d="M 68 68 Q 95 95 125 110" stroke="#fef08a" stroke-dasharray="4,3" marker-end="url(#arrow)" />
            <text x="75" y="100" fill="#fef08a" stroke="none" font-size="11" font-family="sans-serif">Sunlight</text>

            <!-- Cây & Chiếc lá lớn -->
            <path d="M 120 180 Q 150 90 220 85 Q 260 140 180 170 Z" stroke="#86efac" fill="rgba(134,239,172,0.12)" />
            <path d="M 140 160 Q 185 130 220 85" stroke="#86efac" />
            <path d="M 170 140 Q 190 120 205 125" stroke="#86efac" />
            <path d="M 160 150 Q 155 130 170 120" stroke="#86efac" />

            <!-- Khí CO2 đi vào -->
            <path d="M 100 135 L 135 140" stroke="#67e8f9" stroke-dasharray="3,2" />
            <text x="70" y="138" fill="#67e8f9" stroke="none" font-size="12" font-family="sans-serif" font-weight="bold">+ CO₂</text>

            <!-- Khí O2 giải phóng -->
            <path d="M 230 100 L 265 85" stroke="#93c5fd" stroke-dasharray="3,2" />
            <text x="270" y="85" fill="#93c5fd" stroke="none" font-size="12" font-family="sans-serif" font-weight="bold">O₂ ↑</text>

            <!-- Nước H2O từ rễ -->
            <path d="M 120 215 L 125 175" stroke="#38bdf8" stroke-dasharray="4,2" />
            <text x="80" y="215" fill="#38bdf8" stroke="none" font-size="12" font-family="sans-serif" font-weight="bold">+ H₂O (rễ)</text>

            <!-- Sản phẩm Glucose -->
            <text x="180" y="200" fill="#fbcfe8" stroke="none" font-size="11" font-family="sans-serif">Glucose (C₆H₁₂O₆)</text>
            <!-- Khung chú thích -->
            <text x="70" y="235" fill="#f8fafc" stroke="none" font-size="12" font-family="sans-serif" font-style="italic">6CO₂ + 6H₂O ➔ C₆H₁₂O₆ + 6O₂</text>
        """
    },

    "cell": {
        "title": "Cấu tạo Tế bào (Cell Structure)",
        "subject": "SINH_HOC",
        "caption": "Mô hình cấu tạo tế bào nhân thực",
        "description": "Tế bào gồm màng sinh chất, tế bào chất, nhân tế bào (DNA), ty thể (nhà máy năng lượng) và ribosome.",
        "tags": ["cell", "te bao", "sinh hoc", "nhan te bao", "biology", "mitochondria"],
        "svg_inner": """
            <!-- Màng tế bào bên ngoài -->
            <ellipse cx="160" cy="120" rx="130" ry="90" stroke="#f8fafc" fill="rgba(248,250,252,0.05)" />
            <!-- Nhân tế bào -->
            <circle cx="150" cy="115" r="38" stroke="#a78bfa" stroke-dasharray="5,2" fill="rgba(167,139,250,0.15)" />
            <circle cx="150" cy="115" r="16" stroke="#c084fc" fill="#c084fc" />
            <text x="135" y="120" fill="#ffffff" stroke="none" font-size="10" font-family="sans-serif">Nucleus</text>
            <!-- Ty thể (Mitochondria) -->
            <ellipse cx="85" cy="85" rx="22" ry="12" stroke="#f472b6" transform="rotate(-25 85 85)" />
            <path d="M 70 85 Q 85 80 100 85" stroke="#f472b6" stroke-dasharray="2,2" />
            <text x="60" y="65" fill="#f472b6" stroke="none" font-size="10" font-family="sans-serif">Mitochondria</text>
            <!-- Không bào / Lục lạp -->
            <ellipse cx="230" cy="140" rx="24" ry="15" stroke="#4ade80" />
            <circle cx="95" cy="155" r="4" stroke="#fbbf24" fill="#fbbf24" />
            <circle cx="110" cy="165" r="3" stroke="#fbbf24" fill="#fbbf24" />
            <circle cx="215" cy="85" r="3" stroke="#fbbf24" fill="#fbbf24" />
            <!-- Chú thích -->
            <text x="110" y="225" fill="#e2e8f0" stroke="none" font-size="12" font-family="sans-serif">Tế bào &amp; Bào quan (Chalk art)</text>
        """
    },

    "heart": {
        "title": "Cấu tạo Trái tim (Heart Anatomy)",
        "subject": "SINH_HOC",
        "caption": "Hệ tuần hoàn và cấu tạo tim 4 ngăn",
        "description": "Tim bơm máu đi nuôi cơ thể qua hai vòng tuần hoàn lớn và nhỏ, gồm tâm thất và tâm nhĩ.",
        "tags": ["heart", "trai tim", "tim", "tuan hoan", "biology", "cardio"],
        "svg_inner": """
            <!-- Trái tim nét phấn -->
            <path d="M 160 85 C 160 50, 110 40, 95 80 C 80 120, 120 160, 160 200 C 200 160, 240 120, 225 80 C 210 40, 160 50, 160 85 Z" 
                  stroke="#f43f5e" fill="rgba(244,63,94,0.12)" stroke-width="3" />
            <!-- Đường vách ngăn tâm thất / tâm nhĩ -->
            <line x1="160" y1="85" x2="160" y2="185" stroke="#f8fafc" stroke-dasharray="4,3" />
            <line x1="105" y1="125" x2="215" y2="125" stroke="#f8fafc" stroke-dasharray="4,3" />
            <!-- Động mạch chủ lên trên -->
            <path d="M 145 60 L 145 25 Q 160 15 175 25 L 175 60" stroke="#f8fafc" />
            <text x="75" y="115" fill="#fecdd3" stroke="none" font-size="10" font-family="sans-serif">Tâm nhĩ P</text>
            <text x="180" y="115" fill="#fecdd3" stroke="none" font-size="10" font-family="sans-serif">Tâm nhĩ T</text>
            <text x="80" y="155" fill="#fecdd3" stroke="none" font-size="10" font-family="sans-serif">Tâm thất P</text>
            <text x="180" y="155" fill="#fecdd3" stroke="none" font-size="10" font-family="sans-serif">Tâm thất T</text>
            <text x="110" y="228" fill="#f8fafc" stroke="none" font-size="12" font-family="sans-serif">Cấu trúc tim 4 ngăn</text>
        """
    },

    # --------------------------------------------------------------------------
    # 2. KHÁI NIỆM ĐỊA LÝ & THIÊN VĂN (GEOGRAPHY / EARTH SCIENCE)
    # --------------------------------------------------------------------------
    "solarsystem": {
        "title": "Hệ Mặt Trời (Solar System)",
        "subject": "DIA_LY",
        "caption": "Mô hình các hành tinh quay quanh Mặt trời",
        "description": "Hệ Mặt trời gồm Mặt trời ở trung tâm và 8 hành tinh: Thủy, Kim, Trái Đất, Hỏa, Mộc, Thổ, Thiên Vương, Hải Vương tinh.",
        "tags": ["solar system", "he mat troi", "dia ly", "geography", "astronomy", "hanh tinh"],
        "svg_inner": """
            <!-- Mặt trời ở góc trái -->
            <circle cx="20" cy="120" r="45" stroke="#fde047" fill="rgba(253,224,71,0.2)" />
            <text x="5" y="125" fill="#fef08a" stroke="none" font-size="11" font-family="sans-serif" font-weight="bold">Sun</text>
            <!-- Quỹ đạo elip nét đứt phấn trắng -->
            <ellipse cx="20" cy="120" rx="75" ry="40" stroke="#cbd5e1" stroke-dasharray="3,3" />
            <ellipse cx="20" cy="120" rx="115" ry="60" stroke="#cbd5e1" stroke-dasharray="3,3" />
            <ellipse cx="20" cy="120" rx="160" ry="80" stroke="#cbd5e1" stroke-dasharray="3,3" />
            <ellipse cx="20" cy="120" rx="210" ry="100" stroke="#cbd5e1" stroke-dasharray="3,3" />
            <ellipse cx="20" cy="120" rx="265" ry="118" stroke="#cbd5e1" stroke-dasharray="3,3" />
            <!-- Sao Thủy (Mercury) -->
            <circle cx="95" cy="120" r="5" stroke="#94a3b8" fill="#94a3b8" />
            <!-- Sao Kim (Venus) -->
            <circle cx="135" cy="120" r="7" stroke="#fdba74" fill="#fdba74" />
            <!-- Trái Đất (Earth) & Mặt Trăng -->
            <circle cx="180" cy="120" r="9" stroke="#60a5fa" fill="rgba(96,165,250,0.5)" />
            <circle cx="193" cy="115" r="2.5" stroke="#ffffff" fill="#ffffff" />
            <text x="165" y="142" fill="#93c5fd" stroke="none" font-size="9" font-family="sans-serif">Earth</text>
            <!-- Sao Hỏa (Mars) -->
            <circle cx="230" cy="120" r="6" stroke="#f87171" fill="#f87171" />
            <!-- Sao Mộc (Jupiter) -->
            <circle cx="285" cy="120" r="15" stroke="#fbbf24" fill="rgba(251,191,36,0.3)" />
            <line x1="272" y1="120" x2="298" y2="120" stroke="#fbbf24" stroke-dasharray="2,2" />
            <text x="270" y="146" fill="#fde68a" stroke="none" font-size="9" font-family="sans-serif">Jupiter</text>
            <!-- Chú thích -->
            <text x="105" y="230" fill="#f8fafc" stroke="none" font-size="12" font-family="sans-serif">Quỹ đạo các hành tinh quanh Mặt Trời</text>
        """
    },

    "volcano": {
        "title": "Núi Lửa Phun Trào (Volcano Eruption)",
        "subject": "DIA_LY",
        "caption": "Cấu tạo núi lửa và dòng dung nham",
        "description": "Núi lửa hình thành từ vết nứt vỏ Trái Đất, giải phóng magma (dung nham), tro bụi, khí lưu huỳnh khi áp suất tầng manti dâng cao.",
        "tags": ["volcano", "nui lua", "dia ly", "geography", "dung nham", "magma"],
        "svg_inner": """
            <!-- Thân núi lửa dạng nón nét phấn trắng -->
            <path d="M 20 210 L 120 120 L 150 120 L 165 120 L 195 120 L 295 210 Z" stroke="#f8fafc" fill="rgba(248,250,252,0.06)" />
            <!-- Các nếp gấp sườn núi nét gạch -->
            <path d="M 125 125 Q 110 165 70 210" stroke="#cbd5e1" stroke-dasharray="4,2" />
            <path d="M 185 125 Q 200 165 245 210" stroke="#cbd5e1" stroke-dasharray="4,2" />
            <path d="M 155 130 L 160 210" stroke="#cbd5e1" stroke-dasharray="4,3" />

            <!-- Miệng núi lửa (Crater) & Ống dẫn Magma -->
            <ellipse cx="157" cy="120" rx="23" ry="7" stroke="#fb923c" fill="#ea580c" />
            <path d="M 148 127 Q 155 170 157 210" stroke="#f97316" stroke-width="4" />
            <text x="165" y="180" fill="#fdba74" stroke="none" font-size="10" font-family="sans-serif">Magma conduit</text>

            <!-- Cột khói & Tro bụi trên cao -->
            <path d="M 145 115 Q 120 70 100 45 Q 150 15 190 35 Q 220 55 175 115 Z" stroke="#e2e8f0" stroke-dasharray="5,3" fill="rgba(226,232,240,0.15)" />
            <text x="130" y="55" fill="#f1f5f9" stroke="none" font-size="11" font-family="sans-serif">Ash Cloud</text>

            <!-- Dung nham phun trào (Lava flow) -->
            <path d="M 140 120 Q 130 145 115 170" stroke="#ef4444" stroke-width="3" />
            <path d="M 170 120 Q 185 150 205 180" stroke="#ef4444" stroke-width="3" />
            <circle cx="140" cy="100" r="3" stroke="#f97316" fill="#f97316" />
            <circle cx="170" cy="95" r="4" stroke="#f97316" fill="#f97316" />
            <circle cx="155" cy="85" r="2.5" stroke="#facc15" fill="#facc15" />

            <!-- Chú thích chân hình -->
            <text x="100" y="230" fill="#f8fafc" stroke="none" font-size="12" font-family="sans-serif">Cấu trúc núi lửa &amp; Phun trào dung nham</text>
        """
    },

    "watercycle": {
        "title": "Vòng tuần hoàn của nước (Water Cycle)",
        "subject": "DIA_LY",
        "caption": "Chu trình bốc hơi, ngưng tụ và mưa",
        "description": "Nước bốc hơi từ biển hồ nhờ năng lượng mặt trời, ngưng tụ thành mây và rơi xuống đất dưới dạng mưa rồi trở về đại dương.",
        "tags": ["water cycle", "vong tuan hoan nuoc", "dia ly", "nuoc", "mua", "boc hoi"],
        "svg_inner": """
            <!-- Mặt trời góc trái trên -->
            <circle cx="45" cy="45" r="18" stroke="#facc15" />
            <!-- Biển / Đại dương ở đáy -->
            <path d="M 10 200 Q 80 190 160 200 T 310 200 L 310 225 L 10 225 Z" stroke="#38bdf8" fill="rgba(56,189,248,0.15)" />
            <text x="210" y="218" fill="#7dd3fc" stroke="none" font-size="11" font-family="sans-serif">Ocean / Sea</text>

            <!-- Mũi tên bốc hơi (Evaporation) -->
            <path d="M 70 185 Q 60 140 75 110" stroke="#67e8f9" stroke-dasharray="3,3" />
            <path d="M 95 185 Q 85 140 100 110" stroke="#67e8f9" stroke-dasharray="3,3" />
            <text x="40" y="145" fill="#67e8f9" stroke="none" font-size="10" font-family="sans-serif">Evaporation ↑</text>

            <!-- Mây ngưng tụ (Condensation) -->
            <path d="M 160 75 Q 170 50 195 55 Q 220 45 235 65 Q 255 70 250 90 Q 240 110 205 105 Q 175 115 160 95 Z" stroke="#f8fafc" fill="rgba(255,255,255,0.12)" />
            <text x="180" y="85" fill="#f8fafc" stroke="none" font-size="10" font-family="sans-serif">Cloud</text>

            <!-- Mưa rơi (Precipitation) -->
            <line x1="180" y1="120" x2="170" y2="145" stroke="#93c5fd" stroke-dasharray="3,3" />
            <line x1="200" y1="125" x2="190" y2="150" stroke="#93c5fd" stroke-dasharray="3,3" />
            <line x1="220" y1="120" x2="210" y2="145" stroke="#93c5fd" stroke-dasharray="3,3" />
            <text x="205" y="145" fill="#93c5fd" stroke="none" font-size="10" font-family="sans-serif">Precipitation ↓</text>

            <!-- Núi ở bên phải đón mưa -->
            <path d="M 230 200 L 275 150 L 310 200" stroke="#cbd5e1" />
            <text x="90" y="235" fill="#f8fafc" stroke="none" font-size="12" font-family="sans-serif">Vòng tuần hoàn nước tự nhiên</text>
        """
    },

    # --------------------------------------------------------------------------
    # 3. TỪ VỰNG TIẾNG ANH PHỔ THÔNG (ENGLISH VOCABULARY)
    # --------------------------------------------------------------------------
    "apple": {
        "title": "Apple /ˈæpl/ (Noun)",
        "subject": "TIENG_ANH",
        "caption": "Quả táo nét phấn trắng",
        "description": "An apple a day keeps the doctor away.",
        "tags": ["apple", "qua tao", "tao", "trai cay", "fruit", "english"],
        "svg_inner": """
            <path d="M 160 85 C 140 45, 90 60, 95 115 C 100 170, 140 200, 160 200 C 180 200, 220 170, 225 115 C 230 60, 180 45, 160 85 Z" 
                  stroke="#ef4444" fill="rgba(239,68,68,0.1)" stroke-width="3" />
            <!-- Cuống táo & Chiếc lá -->
            <path d="M 160 85 Q 165 50 175 40" stroke="#f8fafc" stroke-width="3" />
            <path d="M 165 60 Q 195 50 200 65 Q 185 80 165 60 Z" stroke="#4ade80" fill="rgba(74,222,128,0.3)" />
            <!-- Vệt sáng phản quang -->
            <path d="M 120 95 Q 115 125 122 150" stroke="#f8fafc" stroke-width="2" stroke-dasharray="15,5" />
            <text x="115" y="225" fill="#f8fafc" stroke="none" font-size="13" font-family="sans-serif" font-weight="bold">Apple /'æpl/</text>
        """
    },

    "tree": {
        "title": "Tree /triː/ (Noun)",
        "subject": "TIENG_ANH",
        "caption": "Cây xanh nét phấn trắng",
        "description": "A perennial plant with an elongated stem, or trunk, supporting branches and leaves.",
        "tags": ["tree", "cay", "cay xanh", "english", "nature"],
        "svg_inner": """
            <!-- Thân cây -->
            <path d="M 145 210 L 148 135 L 172 135 L 175 210 Z" stroke="#cbd5e1" fill="rgba(203,213,225,0.1)" />
            <!-- Rễ cây -->
            <path d="M 145 210 Q 130 220 120 220" stroke="#cbd5e1" />
            <path d="M 175 210 Q 190 220 200 220" stroke="#cbd5e1" />
            <!-- Vòm lá sum suê dạng mây nét phấn -->
            <path d="M 148 135 Q 110 140 105 110 Q 95 80 125 70 Q 120 40 160 40 Q 200 40 195 70 Q 225 80 215 110 Q 210 140 172 135 Z" 
                  stroke="#4ade80" fill="rgba(74,222,128,0.15)" stroke-width="3" />
            <!-- Nhánh cây bên trong -->
            <path d="M 160 135 L 140 100" stroke="#cbd5e1" />
            <path d="M 160 135 L 180 100" stroke="#cbd5e1" />
            <text x="125" y="235" fill="#f8fafc" stroke="none" font-size="13" font-family="sans-serif" font-weight="bold">Tree /triː/</text>
        """
    },

    "book": {
        "title": "Book /bʊk/ (Noun)",
        "subject": "TIENG_ANH",
        "caption": "Cuốn sách mở nét phấn trắng",
        "description": "Reading books enriches your knowledge and imagination.",
        "tags": ["book", "sach", "doc sach", "english", "education"],
        "svg_inner": """
            <!-- Gáy sách ở giữa -->
            <path d="M 160 80 L 160 185" stroke="#f8fafc" stroke-width="3" />
            <!-- Trang sách bên trái uốn lượn -->
            <path d="M 160 80 Q 110 65 60 75 L 60 180 Q 110 170 160 185 Z" stroke="#f8fafc" fill="rgba(248,250,252,0.08)" />
            <!-- Trang sách bên phải uốn lượn -->
            <path d="M 160 80 Q 210 65 260 75 L 260 180 Q 210 170 160 185 Z" stroke="#f8fafc" fill="rgba(248,250,252,0.08)" />
            <!-- Dòng chữ tượng trưng nét phấn -->
            <line x1="80" y1="105" x2="140" y2="100" stroke="#cbd5e1" stroke-dasharray="4,3" />
            <line x1="80" y1="125" x2="140" y2="120" stroke="#cbd5e1" stroke-dasharray="4,3" />
            <line x1="80" y1="145" x2="130" y2="140" stroke="#cbd5e1" stroke-dasharray="4,3" />
            <line x1="180" y1="100" x2="240" y2="105" stroke="#cbd5e1" stroke-dasharray="4,3" />
            <line x1="180" y1="120" x2="240" y2="125" stroke="#cbd5e1" stroke-dasharray="4,3" />
            <line x1="180" y1="140" x2="230" y2="145" stroke="#cbd5e1" stroke-dasharray="4,3" />
            <text x="120" y="215" fill="#f8fafc" stroke="none" font-size="13" font-family="sans-serif" font-weight="bold">Book /bʊk/</text>
        """
    },

    "house": {
        "title": "House /haʊs/ (Noun)",
        "subject": "TIENG_ANH",
        "caption": "Ngôi nhà nét phấn trắng",
        "description": "Home is where the heart is.",
        "tags": ["house", "nha", "ngoi nha", "home", "english"],
        "svg_inner": """
            <!-- Mái nhà hình tam giác -->
            <polygon points="160,55 80,115 240,115" stroke="#f8fafc" fill="rgba(248,250,252,0.08)" stroke-width="3" />
            <!-- Ống khói -->
            <path d="M 200 85 L 200 65 L 215 65 L 215 97" stroke="#f8fafc" />
            <!-- Khói bốc lên -->
            <path d="M 207 55 Q 215 45 205 35 Q 215 25 210 15" stroke="#cbd5e1" stroke-dasharray="3,2" />
            <!-- Thân nhà hình hộp -->
            <rect x="95" y="115" width="130" height="90" stroke="#f8fafc" fill="rgba(248,250,252,0.05)" />
            <!-- Cửa ra vào -->
            <rect x="145" y="145" width="30" height="60" stroke="#f8fafc" />
            <circle cx="170" cy="175" r="2" stroke="#f8fafc" fill="#f8fafc" />
            <!-- Cửa sổ có rèm -->
            <rect x="108" y="130" width="25" height="25" stroke="#f8fafc" />
            <line x1="120.5" y1="130" x2="120.5" y2="155" stroke="#f8fafc" />
            <line x1="108" y1="142.5" x2="133" y2="142.5" stroke="#f8fafc" />
            <rect x="187" y="130" width="25" height="25" stroke="#f8fafc" />
            <line x1="199.5" y1="130" x2="199.5" y2="155" stroke="#f8fafc" />
            <line x1="187" y1="142.5" x2="212" y2="142.5" stroke="#f8fafc" />
            <text x="110" y="230" fill="#f8fafc" stroke="none" font-size="13" font-family="sans-serif" font-weight="bold">House /haʊs/</text>
        """
    }
}


class IllustrationService:
    """
    Dịch vụ AI tạo hình minh họa nét vẽ phấn trắng (Chalkboard Sketch)
    cho từ vựng Tiếng Anh và khái niệm Sinh học, Địa lý.
    """

    def __init__(self):
        self.templates = CHALK_TEMPLATES

    def normalize_key(self, text: str) -> str:
        """Chuẩn hóa từ khóa tìm kiếm (bỏ dấu, chuyển chữ thường, loại bỏ ký tự lạ)."""
        if not text:
            return ""
        clean = text.lower().strip()
        # Bỏ dấu tiếng Việt cơ bản
        clean = re.sub(r"[àáạảãâầấậẩẫăằắặẳẵ]", "a", clean)
        clean = re.sub(r"[èéẹẻẽêềếệểễ]", "e", clean)
        clean = re.sub(r"[ìíịỉĩ]", "i", clean)
        clean = re.sub(r"[òóọỏõôồốộổỗơờớợởỡ]", "o", clean)
        clean = re.sub(r"[ùúụủũưừứựửữ]", "u", clean)
        clean = re.sub(r"[ỳýỵỷỹ]", "y", clean)
        clean = re.sub(r"[đ]", "d", clean)
        clean = re.sub(r"[^a-z0-9]", "", clean)
        return clean

    def find_matching_template(self, concept: str) -> Optional[Dict[str, Any]]:
        """Tìm mẫu hình vẽ phấn trắng phù hợp theo từ khóa."""
        norm_input = self.normalize_key(concept)
        if not norm_input:
            return None

        # 1. Tìm khớp chính xác key
        if norm_input in self.templates:
            return self.templates[norm_input]

        # 2. Tìm theo danh sách tags
        for key, item in self.templates.items():
            tags = [self.normalize_key(t) for t in item.get("tags", [])]
            if norm_input in tags:
                return item
            # Khớp chuỗi con nếu từ khóa dài (vd "the volcano" -> "volcano")
            if any(t in norm_input or norm_input in t for t in tags if len(t) >= 4):
                return item

        return None

    def generate_chalk_illustration(
        self,
        concept: str,
        subject: str = "TIENG_ANH",
        target_bbox: Optional[List[int]] = None
    ) -> ChalkIllustrationData:
        """
        Tạo ảnh minh họa nét phấn trắng cho từ vựng hoặc khái niệm:
        - Ưu tiên kho mẫu Vector SVG phấn trắng học đường sắc nét.
        - Tự động sinh SVG phấn trắng tương ứng nếu là khái niệm mới.
        - Trả về mã SVG và Data URL Base64 sẵn sàng đưa lên Canvas Fabric.js.
        - Tính toán tọa độ vị trí đặt cạnh từ vựng trên bảng.
        """
        raw_concept = (concept or "Concept").strip()
        matched = self.find_matching_template(raw_concept)

        # Tính toán vị trí đặt cạnh từ vựng (Next to the vocabulary/concept)
        # Nếu có target_bbox [x, y, width, height], đặt bên phải cách 25px
        pos_x = 320
        pos_y = 60
        pos_w = 220
        pos_h = 220

        if target_bbox and len(target_bbox) >= 4:
            bx, by, bw, bh = target_bbox[:4]
            pos_x = max(10, int(bx + bw + 25))
            pos_y = max(10, int(by))

        if matched:
            svg_str = _svg_wrap(matched["svg_inner"], width=320, height=240, title=matched["title"])
            svg_b64 = base64.b64encode(svg_str.encode("utf-8")).decode("utf-8")
            data_url = f"data:image/svg+xml;base64,{svg_b64}"

            return ChalkIllustrationData(
                concept=raw_concept,
                subject=matched.get("subject", subject),
                illustration_type="CHALK_SVG",
                svg_content=svg_str,
                image_data_url=data_url,
                caption=matched.get("caption", f"Minh họa: {raw_concept}"),
                suggested_position={"x": pos_x, "y": pos_y, "width": pos_w, "height": pos_h},
                description=matched.get("description", f"Hình vẽ minh họa phấn trắng cho khái niệm {raw_concept}."),
                tags=matched.get("tags", [raw_concept])
            )

        # Fallback tạo SVG phấn trắng tự động cho khái niệm bất kỳ
        auto_svg = self._generate_procedural_chalk_svg(raw_concept, subject)
        svg_b64 = base64.b64encode(auto_svg.encode("utf-8")).decode("utf-8")
        data_url = f"data:image/svg+xml;base64,{svg_b64}"

        return ChalkIllustrationData(
            concept=raw_concept,
            subject=subject,
            illustration_type="CHALK_SVG",
            svg_content=auto_svg,
            image_data_url=data_url,
            caption=f"Hình minh họa phấn trắng: {raw_concept}",
            suggested_position={"x": pos_x, "y": pos_y, "width": pos_w, "height": pos_h},
            description=f"Nét vẽ phấn trắng trực quan hóa khái niệm {raw_concept} trên bảng tương tác.",
            tags=[raw_concept, subject]
        )

    def _generate_procedural_chalk_svg(self, concept: str, subject: str) -> str:
        """Tạo hình vector phấn trắng học đường mang tính biểu tượng cho khái niệm tùy biến."""
        display_name = concept.strip()
        if len(display_name) > 22:
            display_name = display_name[:20] + "..."

        inner = f"""
            <!-- Khung vẽ phấn bảng đen -->
            <rect x="25" y="25" width="270" height="190" rx="14" stroke="#f8fafc" stroke-width="2.5" stroke-dasharray="6,4" fill="rgba(248,250,252,0.04)" />
            <!-- Biểu tượng ý niệm ở giữa -->
            <circle cx="160" cy="100" r="42" stroke="#67e8f9" stroke-width="3" />
            <path d="M 135 100 L 152 118 L 188 82" stroke="#a7f3d0" stroke-width="3.5" stroke-linecap="round" />
            <circle cx="160" cy="100" r="52" stroke="#cbd5e1" stroke-dasharray="3,3" />
            <!-- Tia sáng / Ý niệm xung quanh -->
            <line x1="160" y1="40" x2="160" y2="30" stroke="#fef08a" />
            <line x1="215" y1="70" x2="225" y2="62" stroke="#fef08a" />
            <line x1="105" y1="70" x2="95" y2="62" stroke="#fef08a" />
            <!-- Nhãn khái niệm viết tay phấn trắng -->
            <text x="160" y="175" fill="#f8fafc" stroke="none" font-size="14" font-family="Arial, sans-serif" font-weight="bold" text-anchor="middle">{display_name}</text>
            <text x="160" y="196" fill="#94a3b8" stroke="none" font-size="11" font-family="Arial, sans-serif" text-anchor="middle">Chalk Sketch · {subject}</text>
        """
        return _svg_wrap(inner, width=320, height=240, title=f"Minh họa {concept}")


illustration_service = IllustrationService()
