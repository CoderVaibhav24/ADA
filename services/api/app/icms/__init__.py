"""ICMS — the illegal-construction enforcement domain.

`workflow.py` is the policy: the state machine, the role permitted to make each
transition, and the payload each one requires. It is imported by every ICMS
router and by nothing else, so the rules have one home.
"""
