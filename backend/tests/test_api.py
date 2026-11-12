import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_health_check():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "healthy"


def test_request_otp():
    response = client.post(
        "/api/v1/auth/request-otp",
        json={"email": "teacher@rikkei.edu.vn", "phone_number": "0987654321"}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert "dev_otp_code" in data


def test_verify_otp():
    response = client.post(
        "/api/v1/auth/verify-otp",
        json={"email": "teacher@rikkei.edu.vn", "phone_number": "0987654321", "otp_code": "123456"}
    )
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["role"] == "TEACHER"


def test_mock_canvas_recognition():
    response = client.post(
        "/api/v1/canvas/recognize",
        json={"image_base64": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "subject": "MATH"}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["subject"] == "MATH"
    assert "y = x^2 - 4x + 3" in data["recognized_text"]
    assert data["visualization"]["type"] == "2D_GRAPH"
