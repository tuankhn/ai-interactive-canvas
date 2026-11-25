import { fabricCanvas } from './context.js';

/**
 * Mở rộng danh sách đối tượng cần xóa theo quan hệ sở hữu (Cascade Delete):
 * - Xóa [ĐỀ BÀI] -> xóa kèm badge [ĐỀ BÀI], khung answer_zone, các phương án & dấu chấm thuộc câu đó.
 * - Xóa [BƯỚC GIẢI] hoặc nét đã chấm -> xóa kèm badge [BƯỚC GIẢI] và dấu ✓ / gạch chân đỏ / ✕ Gợi ý của bước đó.
 */
export function expandCascadeTargets(initialTargets) {
  const allObjects = fabricCanvas.getObjects();
  const toDelete = new Set((initialTargets || []).filter(Boolean));
  let expanded = true;

  while (expanded) {
    expanded = false;
    const removedGroupIds = new Set();
    const removedStepOwnerIds = new Set();

    for (const obj of toDelete) {
      const m = obj?.meta;
      if (!m) continue;
      if (m.questionGroupId) removedGroupIds.add(m.questionGroupId);
      if (m.linkedGroupId && m.dataRole === 'question_badge') removedGroupIds.add(m.linkedGroupId);
      if (m.stepOwnerId) removedStepOwnerIds.add(m.stepOwnerId);
      if (m.strokeId) removedStepOwnerIds.add(m.strokeId);
    }

    for (const obj of allObjects) {
      if (toDelete.has(obj)) continue;
      const m = obj?.meta;
      if (!m) continue;

      const ownedByRemovedGroup =
        (m.linkedGroupId && removedGroupIds.has(m.linkedGroupId)) ||
        (m.gradedQuestionId && removedGroupIds.has(m.gradedQuestionId)) ||
        (m.questionGroupId && removedGroupIds.has(m.questionGroupId)) ||
        (m.type === 'quiz_feedback_mark' && m.question_id && removedGroupIds.has(m.question_id));

      const ownedByRemovedStep =
        m.linkedStepOwnerId && removedStepOwnerIds.has(m.linkedStepOwnerId);

      if (ownedByRemovedGroup || ownedByRemovedStep) {
        toDelete.add(obj);
        expanded = true;
      }
    }
  }

  return Array.from(toDelete);
}

export function removeObjectsWithCascade(targets) {
  const fullList = expandCascadeTargets(targets);
  if (fullList.length > 0) {
    fabricCanvas.remove(...fullList);
  }
  return fullList;
}
