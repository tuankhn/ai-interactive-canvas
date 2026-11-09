from app.schemas.auth import (
    RequestOTPRequest,
    VerifyOTPRequest,
    TokenResponse,
    UserOut,
)
from app.schemas.canvas import (
    RecognizeCanvasRequest,
    RecognizeCanvasResponse,
    AmbiguousToken,
    VisualizationData,
    CorrectTokenRequest,
)
from app.schemas.quiz import (
    QuestionCreate,
    QuestionOut,
    GradeMCQRequest,
    GradeMCQResponse,
    GradeEssayStepRequest,
    GradeEssayStepResponse,
)
from app.schemas.snapshot import (
    SaveSnapshotRequest,
    SnapshotOut,
    LectureReviewResponse,
)

__all__ = [
    "RequestOTPRequest",
    "VerifyOTPRequest",
    "TokenResponse",
    "UserOut",
    "RecognizeCanvasRequest",
    "RecognizeCanvasResponse",
    "AmbiguousToken",
    "VisualizationData",
    "CorrectTokenRequest",
    "QuestionCreate",
    "QuestionOut",
    "GradeMCQRequest",
    "GradeMCQResponse",
    "GradeEssayStepRequest",
    "GradeEssayStepResponse",
    "SaveSnapshotRequest",
    "SnapshotOut",
    "LectureReviewResponse",
]
