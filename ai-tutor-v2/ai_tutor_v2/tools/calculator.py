"""Arithmetic only. Names, calls, and large exponents are rejected."""

from __future__ import annotations

import ast
import re
import time
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ai_tutor_v2.database.models import ToolRun
from ai_tutor_v2.ids import new_id
from ai_tutor_v2.services.planner import PlanningContext

_QUESTION = re.compile(
    r"^\s*(?:what is|calculate|compute)?\s*([0-9().+\-*/%\s]+)\??\s*$",
    re.I,
)
_OPS = {
    ast.Add: lambda left, right: left + right,
    ast.Sub: lambda left, right: left - right,
    ast.Mult: lambda left, right: left * right,
    ast.Div: lambda left, right: left / right,
    ast.FloorDiv: lambda left, right: left // right,
    ast.Mod: lambda left, right: left % right,
}
_MAX_ABS = 1_000_000_000_000


class CalculatorError(Exception):
    pass


def expression_in(text: str) -> str | None:
    match = _QUESTION.match(text or "")
    if match is None:
        return None
    expression = " ".join(match.group(1).split())
    if not re.search(r"\d", expression) or not re.search(r"[+\-*/%]", expression):
        return None
    if len(expression) > 200:
        return None
    return expression


def evaluate(expression: str) -> float:
    try:
        tree = ast.parse(expression, mode="eval")
    except SyntaxError as error:
        raise CalculatorError("not arithmetic") from error
    value = _eval(tree.body, 0)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise CalculatorError("not a number")
    if value != value or abs(value) > _MAX_ABS:  # NaN or overflow
        raise CalculatorError("result out of range")
    return float(value)


def _eval(node: ast.AST, depth: int):
    if depth > 20:
        raise CalculatorError("expression too deep")
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)) and not isinstance(node.value, bool):
        return node.value
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
        value = _eval(node.operand, depth + 1)
        return value if isinstance(node.op, ast.UAdd) else -value
    if isinstance(node, ast.BinOp) and type(node.op) in _OPS:
        left = _eval(node.left, depth + 1)
        right = _eval(node.right, depth + 1)
        try:
            value = _OPS[type(node.op)](left, right)
        except ZeroDivisionError as error:
            raise CalculatorError("division by zero") from error
        return value
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Pow):
        left = _eval(node.left, depth + 1)
        right = _eval(node.right, depth + 1)
        if abs(right) > 8 or abs(left) > 1_000_000:
            raise CalculatorError("exponent too large")
        try:
            value = left ** right
        except OverflowError as error:
            raise CalculatorError("result out of range") from error
        return value
    raise CalculatorError("not arithmetic")


async def attach_calculation(
    session_factory: async_sessionmaker[AsyncSession],
    context: PlanningContext,
    *,
    lesson_id: str,
    version_id: str,
) -> None:
    text = context.interaction.text if context.interaction and context.interaction.text else context.question
    expression = expression_in(text)
    if expression is None:
        return
    started = time.perf_counter()
    status = "succeeded"
    summary = expression
    evidence_id = None
    try:
        result = evaluate(expression)
        rendered = str(int(result)) if result.is_integer() else str(result)
        summary = f"{expression} = {rendered}"[:500]
        evidence_id = new_id("calc")
        context.evidence.append({"source_id": evidence_id, "claim": summary})
    except CalculatorError:
        status = "failed"
        summary = "arithmetic evaluation failed"
    duration_ms = int((time.perf_counter() - started) * 1000)
    async with session_factory() as session:
        session.add(
            ToolRun(
                id=new_id("tool"),
                lesson_id=lesson_id,
                version_id=version_id,
                tool_name="calculator",
                status=status,
                duration_ms=duration_ms,
                summary=summary,
                evidence_id=evidence_id,
                created_at=datetime.now(timezone.utc),
            )
        )
        await session.commit()
