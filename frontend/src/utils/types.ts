export type ToolType = 'pen' | 'highlighter' | 'eraser' | 'select' | 'shape';

export type ChalkColor = '#f5f5f0' | '#fef08a' | '#a5f3fc' | '#fbcfe8' | '#86efac';

export type SubjectType = 'MATH' | 'PHYS' | 'CHEM' | 'ENG' | 'BIO';

export interface VisualizationParams {
  type: '2D_GRAPH' | '3D_GEOMETRY' | '3D_MOLECULE' | 'IMAGE_ILLUSTRATION' | 'NONE';
  engine: 'plotly' | 'threejs' | '3dmol' | 'image';
  title?: string;
  parameters?: Record<string, any>;
  latex_formula?: string;
  image_url?: string;
}

export interface AmbiguousToken {
  bbox: [number, number, number, number];
  detected_text: string;
  confidence: number;
  suggestions: string[];
}

export interface AIRecognitionResult {
  recognized_text: string;
  latex?: string;
  subject: SubjectType;
  confidence: number;
  has_ambiguity: boolean;
  ambiguous_tokens: AmbiguousToken[];
  visualization?: VisualizationParams;
  explanation?: string;
}

export interface BoardSnapshotItem {
  id: string;
  session_id: string;
  page_number: number;
  image_url: string;
  thumbnail_url?: string;
  ai_transcription?: string;
  created_at: string;
}
