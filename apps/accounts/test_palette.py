"""Prevent a web-only or native-only colour update from splitting the design."""
import importlib.util
from pathlib import Path
from django.conf import settings
from django.test import SimpleTestCase


class SharedPaletteTests(SimpleTestCase):
    def test_generated_web_and_native_palettes_are_current(self):
        script = Path(settings.BASE_DIR) / 'scripts/sync_palette.py'
        spec = importlib.util.spec_from_file_location('sync_palette', script)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        for path, content in module.outputs().items():
            with self.subTest(path=path.name):
                self.assertEqual(path.read_text(), content, 'Run python scripts/sync_palette.py')

    def test_browser_palette_loads_before_theme_and_component_styles(self):
        template = (Path(settings.BASE_DIR) / 'templates/base.html').read_text()
        self.assertLess(template.index('css/palette.css'), template.index('js/theme.js'))
        self.assertLess(template.index('css/palette.css'), template.index('css/app.css'))
