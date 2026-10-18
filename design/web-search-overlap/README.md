# Mobile web Search overlap

The supplied screenshot shows the Django website's mobile Search page.
Its idle search form used relative positioning while retaining the active
sticky bar's `top: 56px`. This moved the form over the results without moving
the results down. The reproduced overlap measured 40 pixels.

Resetting `top` to `auto` for the idle form restores a 16-pixel gap. Active
search keeps its existing sticky behaviour.

[Corrected mobile web page](search-fixed.png)

Browser geometry checks passed on the real local website and existing
catalogue data at 328×720, 390×844, 320×420, 844×390 and 1280×900. Load,
typed search and cleared search each retained the 16-pixel gap. Light/dark
and reduced/normal motion were checked. There were no runtime errors or
horizontal overflow. Measurements are saved in `checks.json`.

This is a website CSS change. The live website still requires deployment
and updated static assets; the fix has not been deployed by this task.
