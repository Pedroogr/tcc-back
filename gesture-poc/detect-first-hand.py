"""
POC - Quem levantou a mao PRIMEIRO.

Versao nova e independente do detect-hands.py (o original nao foi alterado).

Diferenca em relacao ao detect-hands.py:
- O original e "sem memoria": a cada frame ele apenas diz quem esta com a mao
  levantada naquele instante, sem saber quem levantou antes.
- Esta versao usa o rastreamento (tracking) do YOLO para dar um ID estavel a
  cada pessoa entre os frames, registra o MOMENTO em que cada pessoa levantou a
  mao e, com isso, determina a ORDEM e quem levantou PRIMEIRO.

Ideia geral:
- Para cada pessoa rastreada, detectamos a transicao "mao abaixada -> mao
  levantada" (borda de subida) e gravamos o instante (time.monotonic()).
- Enquanto a pessoa mantem a mao levantada, esse instante e preservado.
- Quando a pessoa abaixa a mao, o instante e zerado (uma nova levantada conta
  como um novo tempo).
- O "primeiro" e a pessoa com o menor instante de levantada entre as que estao
  com a mao levantada agora.

Controles:
- 'q' encerra.
- 'r' reinicia a rodada (zera todos os tempos), util para comecar uma nova
  disputa de lance do zero.
"""

import time

import cv2
from ultralytics import YOLO

# Modelo de pose (mesmo do POC original).
# Se ficar muito pesado, troca para: "yolo11n-pose.pt"
# Se tua versao nao reconhecer yolo11, tenta: "yolov8s-pose.pt"
model = YOLO("yolo11s-pose.pt")

# 0 = webcam principal.
cap = cv2.VideoCapture(0)
cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1920)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 1080)

# Indices dos keypoints no padrao COCO usado pelo YOLO Pose:
NOSE = 0

LEFT_EYE = 1
RIGHT_EYE = 2
LEFT_EAR = 3
RIGHT_EAR = 4

LEFT_SHOULDER = 5
RIGHT_SHOULDER = 6

LEFT_ELBOW = 7
RIGHT_ELBOW = 8

LEFT_WRIST = 9
RIGHT_WRIST = 10

LEFT_HIP = 11
RIGHT_HIP = 12

# Configuracoes (iguais ao POC original para manter o mesmo comportamento de
# deteccao de mao levantada).
MIN_KEYPOINT_CONF = 0.35
MIN_PERSON_CONF = 0.25
RAISE_MARGIN = 15
MIN_BOX_WIDTH = 45
MIN_BOX_HEIGHT = 90

# Tracker do YOLO. "bytetrack.yaml" e leve; "botsort.yaml" e mais robusto.
TRACKER = "bytetrack.yaml"

# Se uma pessoa some por mais que esse tempo (segundos), esquecemos o estado
# dela para nao acumular IDs antigos.
FORGET_AFTER_SECONDS = 3.0


def point_is_valid(point, min_conf=MIN_KEYPOINT_CONF):
    """Cada point vem no formato [x, y, confidence]."""
    return point[2] >= min_conf


def count_valid_keypoints(keypoints):
    count = 0

    for point in keypoints:
        if point_is_valid(point):
            count += 1

    return count


def box_size_is_valid(box):
    x1, y1, x2, y2 = box

    width = x2 - x1
    height = y2 - y1

    return width >= MIN_BOX_WIDTH and height >= MIN_BOX_HEIGHT


def is_valid_person(keypoints, box):
    """Evita contar deteccoes ruins (caixa so no braco/mao, etc.)."""
    if not box_size_is_valid(box):
        return False

    left_shoulder_valid = point_is_valid(keypoints[LEFT_SHOULDER])
    right_shoulder_valid = point_is_valid(keypoints[RIGHT_SHOULDER])

    has_any_shoulder = left_shoulder_valid or right_shoulder_valid
    has_both_shoulders = left_shoulder_valid and right_shoulder_valid

    has_head = (
        point_is_valid(keypoints[NOSE])
        or point_is_valid(keypoints[LEFT_EYE])
        or point_is_valid(keypoints[RIGHT_EYE])
        or point_is_valid(keypoints[LEFT_EAR])
        or point_is_valid(keypoints[RIGHT_EAR])
    )

    has_hip = (
        point_is_valid(keypoints[LEFT_HIP])
        or point_is_valid(keypoints[RIGHT_HIP])
    )

    valid_keypoints_count = count_valid_keypoints(keypoints)

    if not has_any_shoulder:
        return False

    if has_head:
        return True

    if has_both_shoulders:
        return True

    if has_hip and valid_keypoints_count >= 4:
        return True

    if valid_keypoints_count >= 6:
        return True

    return False


def is_left_hand_raised(keypoints):
    shoulder = keypoints[LEFT_SHOULDER]
    elbow = keypoints[LEFT_ELBOW]
    wrist = keypoints[LEFT_WRIST]

    if not point_is_valid(shoulder):
        return False

    if not point_is_valid(wrist):
        return False

    # No OpenCV, quanto menor o Y, mais alto esta o ponto na imagem.
    wrist_above_shoulder = wrist[1] < shoulder[1] - RAISE_MARGIN

    if not wrist_above_shoulder:
        return False

    if point_is_valid(elbow):
        elbow_not_too_low = elbow[1] < shoulder[1] + 80

        if not elbow_not_too_low:
            return False

    return True


def is_right_hand_raised(keypoints):
    shoulder = keypoints[RIGHT_SHOULDER]
    elbow = keypoints[RIGHT_ELBOW]
    wrist = keypoints[RIGHT_WRIST]

    if not point_is_valid(shoulder):
        return False

    if not point_is_valid(wrist):
        return False

    wrist_above_shoulder = wrist[1] < shoulder[1] - RAISE_MARGIN

    if not wrist_above_shoulder:
        return False

    if point_is_valid(elbow):
        elbow_not_too_low = elbow[1] < shoulder[1] + 80

        if not elbow_not_too_low:
            return False

    return True


def is_hand_raised(keypoints):
    return is_left_hand_raised(keypoints) or is_right_hand_raised(keypoints)


def get_hand_raised_side(keypoints):
    left_raised = is_left_hand_raised(keypoints)
    right_raised = is_right_hand_raised(keypoints)

    if left_raised and right_raised:
        return "DUAS MAOS"

    if left_raised:
        return "MAO ESQUERDA"

    if right_raised:
        return "MAO DIREITA"

    return "NORMAL"


# Estado por pessoa rastreada.
# track_id -> {
#   "raised": bool,          # esta com a mao levantada agora?
#   "raised_at": float|None, # instante (monotonic) em que levantou
#   "last_seen": float,      # ultima vez que foi vista (para limpeza)
# }
raise_state = {}


def update_person_state(track_id, raised, now):
    """Atualiza o estado de uma pessoa e detecta a borda de subida."""
    state = raise_state.get(track_id)

    if state is None:
        state = {"raised": False, "raised_at": None, "last_seen": now}
        raise_state[track_id] = state

    state["last_seen"] = now

    if raised and not state["raised"]:
        # Borda de subida: acabou de levantar a mao.
        state["raised"] = True
        state["raised_at"] = now
    elif not raised and state["raised"]:
        # Abaixou a mao: zera o tempo para a proxima levantada contar de novo.
        state["raised"] = False
        state["raised_at"] = None


def forget_absent_people(now):
    """Remove pessoas que sumiram ha algum tempo."""
    for track_id in list(raise_state.keys()):
        if now - raise_state[track_id]["last_seen"] > FORGET_AFTER_SECONDS:
            del raise_state[track_id]


def compute_raise_order():
    """
    Retorna:
    - order: dict track_id -> posicao (1 = primeiro a levantar)
    - first_id: track_id do primeiro, ou None
    Considera apenas quem esta com a mao levantada agora.
    """
    raised_people = [
        (track_id, state["raised_at"])
        for track_id, state in raise_state.items()
        if state["raised"] and state["raised_at"] is not None
    ]

    raised_people.sort(key=lambda item: item[1])

    order = {}
    for position, (track_id, _) in enumerate(raised_people, start=1):
        order[track_id] = position

    first_id = raised_people[0][0] if raised_people else None

    return order, first_id


print("Iniciando camera...")
print("Pressione 'q' para sair, 'r' para reiniciar a rodada.")

while True:
    ret, frame = cap.read()

    if not ret:
        print("Nao foi possivel acessar a camera.")
        break

    now = time.monotonic()

    # model.track mantem IDs estaveis entre frames (persist=True).
    results = model.track(
        frame,
        imgsz=1280,
        conf=MIN_PERSON_CONF,
        persist=True,
        tracker=TRACKER,
        verbose=False,
    )

    result = results[0]

    detections = []

    if result.keypoints is not None and result.boxes is not None:
        keypoints_list = result.keypoints.data.cpu().numpy()
        boxes = result.boxes.xyxy.cpu().numpy()
        scores = result.boxes.conf.cpu().numpy()

        # IDs do tracker (podem ser None nos primeiros frames).
        if result.boxes.id is not None:
            track_ids = result.boxes.id.cpu().numpy().astype(int)
        else:
            track_ids = [None] * len(boxes)

        for box, keypoints, score, track_id in zip(
            boxes, keypoints_list, scores, track_ids
        ):
            x1, y1, x2, y2 = map(int, box)
            box_int = [x1, y1, x2, y2]

            if not is_valid_person(keypoints, box_int):
                continue

            detections.append({
                "box": box_int,
                "keypoints": keypoints,
                "score": float(score),
                "track_id": None if track_id is None else int(track_id),
            })

    # Atualiza o estado temporal de cada pessoa rastreada.
    for detection in detections:
        track_id = detection["track_id"]

        if track_id is None:
            continue

        update_person_state(
            track_id,
            is_hand_raised(detection["keypoints"]),
            now,
        )

    forget_absent_people(now)

    order, first_id = compute_raise_order()
    raised_count = 0

    for detection in detections:
        box = detection["box"]
        keypoints = detection["keypoints"]
        track_id = detection["track_id"]

        x1, y1, x2, y2 = box

        raised = is_hand_raised(keypoints)
        position = order.get(track_id)

        if raised:
            raised_count += 1

        if track_id is not None and track_id == first_id:
            # Primeiro a levantar: destaque dourado.
            color = (0, 215, 255)
            label = f"#{track_id} 1o - PRIMEIRO"
        elif raised and position is not None:
            color = (0, 255, 0)
            label = f"#{track_id} {position}o a levantar"
        elif raised:
            color = (0, 255, 0)
            label = f"#{track_id} levantou"
        else:
            color = (0, 0, 255)
            id_text = "" if track_id is None else f"#{track_id} "
            label = f"{id_text}normal"

        thickness = 4 if (track_id is not None and track_id == first_id) else 2
        cv2.rectangle(frame, (x1, y1), (x2, y2), color, thickness)

        cv2.putText(
            frame,
            label,
            (x1, max(y1 - 10, 20)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            color,
            2,
        )

        important_points = [
            LEFT_SHOULDER,
            RIGHT_SHOULDER,
            LEFT_ELBOW,
            RIGHT_ELBOW,
            LEFT_WRIST,
            RIGHT_WRIST,
        ]

        for index in important_points:
            point = keypoints[index]

            if point_is_valid(point):
                px, py = int(point[0]), int(point[1])
                cv2.circle(frame, (px, py), 4, color, -1)

    # Painel de informacoes.
    if first_id is not None:
        first_text = f"Primeiro a levantar: #{first_id}"
    else:
        first_text = "Primeiro a levantar: -"

    cv2.putText(
        frame,
        first_text,
        (20, 40),
        cv2.FONT_HERSHEY_SIMPLEX,
        1,
        (0, 215, 255),
        2,
    )

    cv2.putText(
        frame,
        f"Maos levantadas: {raised_count}   Pessoas: {len(detections)}",
        (20, 80),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.8,
        (255, 255, 255),
        2,
    )

    cv2.putText(
        frame,
        "q: sair   r: reiniciar rodada",
        (20, 115),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.6,
        (200, 200, 200),
        2,
    )

    cv2.imshow("POC - Quem levantou a mao primeiro", frame)

    key = cv2.waitKey(1) & 0xFF

    if key == ord("q"):
        break

    if key == ord("r"):
        # Reinicia a rodada: zera todos os tempos de levantada.
        raise_state.clear()

cap.release()
cv2.destroyAllWindows()
