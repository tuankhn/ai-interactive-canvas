// Điểm vào duy nhất: tải toàn bộ module của bảng vẽ.
import { initWhiteboard } from './src/pages/whiteboard.js';
export { scheduleAIDebounce, performAIRecognition } from './src/components/aiRecognition.js';

await initWhiteboard();
