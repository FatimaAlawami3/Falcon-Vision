"""LLM-based rule extraction from documents using the same model as the notebook."""
import json
from pathlib import Path
from typing import Any, Callable, Dict, List


class ExtractionCancelledError(Exception):
    """Raised when a regulation extraction request is cancelled."""


class SafetyRulesExtractor:
    """Extracts safety rules (PPE, Fall, Heat) from documents using LLM."""

    def __init__(self, HF_TOKEN: str):
        """Initialize the extractor with Hugging Face token.

        Args:
            HF_TOKEN: Hugging Face API token for accessing OpenAI-compatible API
        """
        try:
            from openai import OpenAI
        except ImportError as exc:
            raise ImportError("openai package is required for regulation extraction. Install with: pip install openai") from exc

        self.client = OpenAI(
            base_url="https://router.huggingface.co/v1",
            api_key=HF_TOKEN
        )
        self.model = "openai/gpt-oss-20b:groq"

    @staticmethod
    def chunk_text(text: str, max_chars: int = 4000) -> List[str]:
        """Split long text into smaller segments for processing.

        Args:
            text: Text to chunk
            max_chars: Maximum characters per chunk

        Returns:
            List of text chunks
        """
        chunks = []
        for i in range(0, len(text), max_chars):
            chunks.append(text[i : i + max_chars])
        return chunks

    @staticmethod
    def normalize_ppe_items(items: List[str]) -> List[str]:
        """Normalize PPE items using the notebook's approach.

        Steps:
        - Convert to lowercase
        - Singularize (remove plurals)
        - Trim whitespace
        - Remove duplicates

        Args:
            items: List of PPE items

        Returns:
            Normalized and deduplicated list
        """
        normalized = set()

        for item in items:
            if not isinstance(item, str):
                continue

            # Step A: Normalize to lowercase
            item = item.lower().strip()

            # Step B: Simple singularization (remove common plural endings)
            if item.endswith('ies'):
                item = item[:-3] + 'y'
            elif item.endswith('oes'):
                item = item[:-2]
            elif item.endswith('es'):
                item = item[:-2]
            elif item.endswith('s') and not item.endswith('ss'):
                item = item[:-1]

            # Step C: Trim whitespace
            item = item.strip()

            # Skip empty strings
            if item:
                normalized.add(item)

        return sorted(list(normalized))

    def extract_from_text(
        self,
        text: str,
        *,
        should_cancel: Callable[[], bool] | None = None,
    ) -> Dict[str, Any]:
        """Extract safety rules from text using LLM.

        Args:
            text: Text to analyze

        Returns:
            Dictionary with PPE_list, Fall_list, Heat_list
        """
        all_rules = {
            "PPE_list": set(),
            "Fall_list": {"active": "No", "reason": ""},
            "Heat_list": {"active": "No", "reason": ""}
        }

        chunks = self.chunk_text(text)

        for chunk in chunks:
            if should_cancel and should_cancel():
                raise ExtractionCancelledError("Extraction stopped by admin.")

            prompt = f"""Analyze the safety document text below and extract specific safety regulations into JSON format.

    TASK 1: PPE Extraction
    - Extract ONLY a list of physical safety equipment (e.g., "Hard Hat", "Safety Boots").
    - Do NOT extract behavioral rules, colors, sizes, or descriptions.
    - Extract only mandatory equipment for employees.

    TASK 2: Fall & Heat Monitoring
    - If the text requires monitoring for falls/heights or fire/smoke/heat, set "active" to "Yes".
    - Provide the direct quote from the document as the "reason".

    TEXT SEGMENT:
    {chunk}

    INSTRUCTIONS:
    - STEP A (Normalization): Convert every extracted string to lowercase.
    - STEP B (Singularization): Convert plural items to singular (e.g., "helmets" to "helmet").
    - STEP C (Trimming): Remove any leading or trailing whitespace.
    - STEP D (Deduplication): Remove all duplicate entries.
    - Only return standardized PPE terms. Do not return variations of the same equipment.
    - Return ONLY valid JSON.
    - Schema:
    {{
      "PPE_list": ["item1", "item2"],
      "Fall_list": {{"active": "Yes/No", "reason": "proof text"}},
      "Heat_list": {{"active": "Yes/No", "reason": "proof text"}}
    }}
    """

            try:
                completion = self.client.chat.completions.create(
                    model=self.model,
                    messages=[{"role": "user", "content": prompt}],
                    response_format={"type": "json_object"}
                )

                data = json.loads(completion.choices[0].message.content)

                # Merge PPE items
                if "PPE_list" in data and isinstance(data["PPE_list"], list):
                    all_rules["PPE_list"].update(data["PPE_list"])

                # Update Fall and Heat monitoring flags
                for key in ["Fall_list", "Heat_list"]:
                    if key in data and str(data[key].get("active")).lower() == "yes":
                        all_rules[key]["active"] = "Yes"
                        all_rules[key]["reason"] = data[key].get("reason", "")

            except ExtractionCancelledError:
                raise
            except Exception as e:
                print(f"Error processing chunk: {e}")
                continue

        return {
            "PPE_list": self.normalize_ppe_items(list(all_rules["PPE_list"])),
            "Fall_list": all_rules["Fall_list"],
            "Heat_list": all_rules["Heat_list"]
        }

    def extract_from_pdf(
        self,
        pdf_path: Path,
        *,
        should_cancel: Callable[[], bool] | None = None,
    ) -> Dict[str, Any]:
        """Extract rules from a PDF document using Docling.

        Args:
            pdf_path: Path to PDF file

        Returns:
            Dictionary with extracted rules
        """
        try:
            from docling.document_converter import DocumentConverter
        except ImportError:
            raise ImportError("docling package is required. Install with: pip install docling")

        try:
            # Convert PDF to Markdown
            converter = DocumentConverter()
            result = converter.convert(str(pdf_path))
            full_markdown_text = result.document.export_to_markdown()

            if should_cancel and should_cancel():
                raise ExtractionCancelledError("Extraction stopped by admin.")

            # Extract rules from markdown text
            return self.extract_from_text(full_markdown_text, should_cancel=should_cancel)

        except ExtractionCancelledError:
            raise
        except Exception as e:
            print(f"Error processing PDF: {e}")
            return {
                "PPE_list": [],
                "Fall_list": {"active": "No", "reason": ""},
                "Heat_list": {"active": "No", "reason": ""}
            }

    def extract_from_file(
        self,
        file_path: Path,
        *,
        should_cancel: Callable[[], bool] | None = None,
    ) -> Dict[str, Any]:
        """Extract rules from any supported file format.

        Args:
            file_path: Path to file (PDF, DOCX, etc.)

        Returns:
            Dictionary with extracted rules
        """
        file_path = Path(file_path)

        if file_path.suffix.lower() == '.pdf':
            return self.extract_from_pdf(file_path, should_cancel=should_cancel)

        # For other formats, try Docling conversion
        try:
            from docling.document_converter import DocumentConverter
        except ImportError:
            raise ImportError("docling package is required. Install with: pip install docling")

        try:
            converter = DocumentConverter()
            result = converter.convert(str(file_path))
            full_markdown_text = result.document.export_to_markdown()
            if should_cancel and should_cancel():
                raise ExtractionCancelledError("Extraction stopped by admin.")
            return self.extract_from_text(full_markdown_text, should_cancel=should_cancel)
        except ExtractionCancelledError:
            raise
        except Exception as e:
            print(f"Error processing file: {e}")
            return {
                "PPE_list": [],
                "Fall_list": {"active": "No", "reason": ""},
                "Heat_list": {"active": "No", "reason": ""}
            }
