# This call: fix specific lines

An editor checked the text against the house rules and rejected some lines. The data holds
the world bible and `fixes`: each has a path, the kind of text, its maximum length in
characters, the current text and the editor's notes. Rewrite each rejected line so that the
notes no longer apply, keeping its facts, its author's register and its length class.
Use only names, dates and numbers from the bible. Return one entry per path, same paths.
