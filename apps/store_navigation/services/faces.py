"""Extract a face-only texture locally; the source portrait is never returned."""
from io import BytesIO
from functools import lru_cache

from PIL import Image, ImageDraw, ImageOps


class FaceUnavailable(ValueError):
    pass


@lru_cache(maxsize=1)
def face_detector():
    import cv2
    return cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")


def extract_face_texture(photo_bytes):
    import cv2
    import numpy as np

    image = ImageOps.exif_transpose(Image.open(BytesIO(photo_bytes))).convert("RGB")
    image.thumbnail((1024, 1024))
    gray = cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2GRAY)
    faces = face_detector().detectMultiScale(gray, scaleFactor=1.08, minNeighbors=5, minSize=(28, 28))
    if len(faces) == 0:
        raise FaceUnavailable("No face detected. Use a clear, front-facing profile photo.")
    # The dominant face in a portrait is normally the profile owner. Never
    # perform identity recognition or infer a 3D facial scan from a photograph.
    x, y, width, height = map(int, max(faces, key=lambda box: int(box[2]) * int(box[3])))
    box = (x + int(width * .08), y + int(height * .06),
           x + int(width * .92), y + int(height * .98))
    face = image.crop(box).resize((256, 320), Image.Resampling.LANCZOS).convert("RGBA")
    # An oval excludes shoulders, clothing and the portrait's square background.
    mask = Image.new("L", face.size)
    ImageDraw.Draw(mask).ellipse((5, 1, 251, 319), fill=255)
    face.putalpha(mask)
    output = BytesIO()
    face.save(output, format="PNG")
    return output.getvalue()
