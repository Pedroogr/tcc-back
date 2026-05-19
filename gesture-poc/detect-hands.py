import cv2
from ultralytics import YOLO

# Modelo de pose.
# Se ficar muito pesado, troca para: "yolo11n-pose.pt"
# Se tua versão não reconhecer yolo11, tenta: "yolov8s-pose.pt"
model = YOLO("yolo11s-pose.pt")

# 0 = webcam principal.
# Se tiver mais de uma câmera, testa 1, 2, etc.
cap = cv2.VideoCapture(0)

# Tenta aumentar a resolução da câmera.
# Se a webcam não suportar, ela simplesmente usa a resolução disponível.
cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1920)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 1080)

# Índices dos keypoints no padrão COCO usado pelo YOLO Pose:
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

# Configurações
MIN_KEYPOINT_CONF = 0.35
MIN_PERSON_CONF = 0.25

# Margem em pixels para considerar o punho acima do ombro.
# Quanto maior, mais exigente.
RAISE_MARGIN = 15

# Tamanho mínimo da caixa para evitar detectar só braço/mão como pessoa.
MIN_BOX_WIDTH = 45
MIN_BOX_HEIGHT = 90


def point_is_valid(point, min_conf=MIN_KEYPOINT_CONF):
    """
    Cada point vem no formato:
    [x, y, confidence]
    """
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
    """
    Evita contar detecções ruins, como uma caixa apenas no braço ou na mão.

    A ideia é:
    - precisa ter pelo menos um ombro detectado;
    - precisa ter rosto/cabeça OU os dois ombros OU vários pontos válidos;
    - precisa ter uma caixa com tamanho mínimo.
    """

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

    # No OpenCV, quanto menor o Y, mais alto está o ponto na imagem.
    wrist_above_shoulder = wrist[1] < shoulder[1] - RAISE_MARGIN

    if not wrist_above_shoulder:
        return False

    # Se o cotovelo estiver confiável, usa ele como reforço.
    # Mas não obriga o cotovelo a estar perfeito, porque às vezes ele falha.
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

    # No OpenCV, quanto menor o Y, mais alto está o ponto na imagem.
    wrist_above_shoulder = wrist[1] < shoulder[1] - RAISE_MARGIN

    if not wrist_above_shoulder:
        return False

    # Se o cotovelo estiver confiável, usa ele como reforço.
    if point_is_valid(elbow):
        elbow_not_too_low = elbow[1] < shoulder[1] + 80

        if not elbow_not_too_low:
            return False

    return True


def is_hand_raised(keypoints):
    left_raised = is_left_hand_raised(keypoints)
    right_raised = is_right_hand_raised(keypoints)

    return left_raised or right_raised


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


def box_iou(box_a, box_b):
    """
    Calcula IoU entre duas caixas.
    Usado para evitar desenhar/contar detecções duplicadas.
    """
    ax1, ay1, ax2, ay2 = box_a
    bx1, by1, bx2, by2 = box_b

    inter_x1 = max(ax1, bx1)
    inter_y1 = max(ay1, by1)
    inter_x2 = min(ax2, bx2)
    inter_y2 = min(ay2, by2)

    inter_width = max(0, inter_x2 - inter_x1)
    inter_height = max(0, inter_y2 - inter_y1)
    inter_area = inter_width * inter_height

    area_a = max(0, ax2 - ax1) * max(0, ay2 - ay1)
    area_b = max(0, bx2 - bx1) * max(0, by2 - by1)

    union_area = area_a + area_b - inter_area

    if union_area == 0:
        return 0

    return inter_area / union_area


def remove_duplicate_detections(detections):
    """
    Remove detecções muito sobrepostas.

    Cada item em detections:
    {
        "box": box,
        "keypoints": keypoints,
        "score": score
    }

    Mantém a detecção com maior score e mais keypoints válidos.
    """
    if not detections:
        return []

    detections = sorted(
        detections,
        key=lambda det: (
            det["score"],
            count_valid_keypoints(det["keypoints"])
        ),
        reverse=True
    )

    selected = []

    for detection in detections:
        should_keep = True

        for selected_detection in selected:
            iou = box_iou(detection["box"], selected_detection["box"])

            if iou > 0.45:
                should_keep = False
                break

        if should_keep:
            selected.append(detection)

    return selected


print("Iniciando câmera...")
print("Pressione 'q' para sair.")

while True:
    ret, frame = cap.read()

    if not ret:
        print("Não foi possível acessar a câmera.")
        break

    # Roda o YOLO Pose no frame atual.
    results = model(
        frame,
        imgsz=1280,
        conf=MIN_PERSON_CONF,
        verbose=False
    )

    result = results[0]

    detections = []

    if result.keypoints is not None and result.boxes is not None:
        keypoints_list = result.keypoints.data.cpu().numpy()
        boxes = result.boxes.xyxy.cpu().numpy()
        scores = result.boxes.conf.cpu().numpy()

        for box, keypoints, score in zip(boxes, keypoints_list, scores):
            x1, y1, x2, y2 = map(int, box)

            box_int = [x1, y1, x2, y2]

            if not is_valid_person(keypoints, box_int):
                continue

            detections.append({
                "box": box_int,
                "keypoints": keypoints,
                "score": float(score)
            })

    detections = remove_duplicate_detections(detections)

    raised_count = 0

    for detection in detections:
        box = detection["box"]
        keypoints = detection["keypoints"]

        x1, y1, x2, y2 = box

        raised = is_hand_raised(keypoints)
        side = get_hand_raised_side(keypoints)

        if raised:
            raised_count += 1
            color = (0, 255, 0)
            label = side
        else:
            color = (0, 0, 255)
            label = "normal"

        cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)

        cv2.putText(
            frame,
            label,
            (x1, max(y1 - 10, 20)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            color,
            2,
        )

        # Desenha pontos importantes para debug.
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

    cv2.putText(
        frame,
        f"Maos levantadas: {raised_count}",
        (20, 40),
        cv2.FONT_HERSHEY_SIMPLEX,
        1,
        (255, 255, 255),
        2,
    )

    cv2.putText(
        frame,
        f"Pessoas validas: {len(detections)}",
        (20, 80),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.8,
        (255, 255, 255),
        2,
    )

    cv2.imshow("POC - Camera - Mao levantada", frame)

    if cv2.waitKey(1) & 0xFF == ord("q"):
        break

cap.release()
cv2.destroyAllWindows()