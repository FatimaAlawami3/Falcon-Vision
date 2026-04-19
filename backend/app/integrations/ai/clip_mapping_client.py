from dataclasses import dataclass
from typing import List, Dict, Tuple
import numpy as np


@dataclass
class TextImageMatch:
    """Represents a match between text description and image class."""
    text_description: str
    image_class: str
    similarity_score: float
    confidence: float


class CLIPMappingClient:
    """Client for mapping text descriptions to visual classes using CLIP."""

    def __init__(self):
        """Initialize CLIP model for text-image matching."""
        try:
            import clip
            import torch

            self.device = "cuda" if torch.cuda.is_available() else "cpu"
            self.model, self.preprocess = clip.load("ViT-B/32", device=self.device)
            self.tokenizer = clip.tokenize

        except ImportError:
            raise ImportError("clip and torch packages are required. Install with: pip install git+https://github.com/openai/CLIP.git torch")

    def encode_text(self, texts: List[str]) -> np.ndarray:
        """Encode text descriptions to embeddings.

        Args:
            texts: List of text descriptions

        Returns:
            Text embeddings as numpy array
        """
        import torch

        text_tokens = self.tokenizer(texts).to(self.device)

        with torch.no_grad():
            text_features = self.model.encode_text(text_tokens)

        # Normalize features
        text_features = text_features / text_features.norm(dim=-1, keepdim=True)

        return text_features.cpu().numpy()

    def encode_image_classes(self, class_names: List[str]) -> Dict[str, np.ndarray]:
        """Encode image class names to embeddings.

        Args:
            class_names: List of class names detected by vision models

        Returns:
            Dictionary mapping class names to embeddings
        """
        # Create descriptive prompts for each class
        prompts = []
        for class_name in class_names:
            # Create multiple prompts for better matching
            prompts.extend([
                f"a photo of {class_name}",
                f"{class_name} being worn",
                f"person wearing {class_name}",
                f"safety {class_name}",
                f"protective {class_name}"
            ])

        embeddings = self.encode_text(prompts)

        # Group embeddings by class (average multiple prompts)
        class_embeddings = {}
        prompts_per_class = 5

        for i, class_name in enumerate(class_names):
            start_idx = i * prompts_per_class
            end_idx = start_idx + prompts_per_class
            class_embedding = np.mean(embeddings[start_idx:end_idx], axis=0)
            class_embeddings[class_name] = class_embedding

        return class_embeddings

    def match_text_to_classes(self, text_descriptions: List[str],
                            detected_classes: List[str],
                            threshold: float = 0.25) -> List[TextImageMatch]:
        """Match text descriptions to detected image classes.

        Args:
            text_descriptions: List of text descriptions from rules
            detected_classes: List of classes detected in image
            threshold: Minimum similarity threshold

        Returns:
            List of matches above threshold
        """
        if not text_descriptions or not detected_classes:
            return []

        # Encode text descriptions
        text_embeddings = self.encode_text(text_descriptions)

        # Encode detected classes
        class_embeddings = self.encode_image_classes(detected_classes)

        matches = []

        for text_desc, text_emb in zip(text_descriptions, text_embeddings):
            best_match = None
            best_score = 0.0

            for class_name, class_emb in class_embeddings.items():
                # Cosine similarity
                similarity = np.dot(text_emb, class_emb) / (
                    np.linalg.norm(text_emb) * np.linalg.norm(class_emb)
                )

                if similarity > best_score:
                    best_score = similarity
                    best_match = class_name

            if best_score >= threshold:
                matches.append(TextImageMatch(
                    text_description=text_desc,
                    image_class=best_match,
                    similarity_score=best_score,
                    confidence=min(best_score * 2, 1.0)  # Scale confidence
                ))

        return matches

    def map_ppe_requirements(self, required_ppe_text: List[str],
                           detected_ppe_classes: List[str]) -> Dict[str, str]:
        """Map PPE requirements from text to detected classes.

        Args:
            required_ppe_text: List of required PPE descriptions
            detected_ppe_classes: List of detected PPE classes

        Returns:
            Dictionary mapping required PPE to detected classes
        """
        matches = self.match_text_to_classes(required_ppe_text, detected_ppe_classes)

        mapping = {}
        for match in matches:
            mapping[match.text_description] = match.image_class

        return mapping