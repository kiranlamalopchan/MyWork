# Workplace colours restored on Pay cards

Native and web Pay cards again derive their gradients and shadows from each workplace's saved hue, with the original gold chip and workplace-coloured pager dots. The rest of the shared palette remains in place, including pure black dark-mode page backgrounds. The web template preserves hue zero instead of treating it as a missing colour.

Six existing native Pay interaction tests, TypeScript and the backend Pay-page rendering test passed. Browser checks verified three distinct workplace colours, pager selection and hue zero in both light and dark appearances without runtime errors. Screenshots use the real website with an isolated temporary database; no installed phone build was tested. No user payment data was changed.
