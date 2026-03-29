import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
import os
import platform
import time
from datetime import datetime

# ===================== 配置 =====================
RTSP_URL = "rtsp://admin:@192.168.1.11:554/Streaming/Channels/101"
WINDOW_NAME = "camera_preview"

# 显示窗口最大尺寸（用于防止 Windows 只显示左上角）
DISPLAY_MAX_WIDTH = 1280
DISPLAY_MAX_HEIGHT = 720

# 按钮坐标（基于原始视频坐标系）
BTN1_X1, BTN1_Y1, BTN1_X2, BTN1_Y2 = 30, 30, 230, 110   # 截图
BTN2_X1, BTN2_Y1, BTN2_X2, BTN2_Y2 = 250, 30, 450, 110  # 录制/停止

# ===================== 全局变量 =====================
is_recording = False
video_writer = None
screenshot_num = 1
current_frame = None
cap = None
record_start_time = None
record_output_file = None

# 显示缩放比例（显示坐标 -> 原图坐标）
display_scale = 1.0


# ===================== 系统相关 =====================
def get_os_name():
    return platform.system().lower()  # windows / darwin / linux


# ===================== 字体加载 =====================
def get_chinese_font(size=32):
    os_name = get_os_name()

    if os_name == "windows":
        font_paths = [
            "C:/Windows/Fonts/msyh.ttc",
            "C:/Windows/Fonts/msyhbd.ttc",
            "C:/Windows/Fonts/simhei.ttf",
            "C:/Windows/Fonts/simsun.ttc",
        ]
    elif os_name == "darwin":
        font_paths = [
            "/System/Library/Fonts/PingFang.ttc",
            "/System/Library/Fonts/STHeiti Light.ttc",
            "/System/Library/Fonts/Hiragino Sans GB.ttc",
            "/Library/Fonts/Arial Unicode.ttf",
        ]
    else:
        font_paths = [
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
        ]

    for path in font_paths:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                pass

    return ImageFont.load_default()


# ===================== 文件名 =====================
def get_video_output_config():
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    os_name = get_os_name()

    if os_name in ("windows", "darwin"):
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        filename = f"camera_record_{timestamp}.mp4"
    else:
        fourcc = cv2.VideoWriter_fourcc(*"XVID")
        filename = f"camera_record_{timestamp}.avi"

    return fourcc, filename


def get_screenshot_filename(index):
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return f"camera_snapshot_{timestamp}_{index}.jpg"


# ===================== 工具函数 =====================
def format_seconds(seconds):
    seconds = int(seconds)
    h = seconds // 3600
    m = (seconds % 3600) // 60
    s = seconds % 60
    return f"{h:02d}:{m:02d}:{s:02d}"


def draw_text(draw, x, y, text, font, fill=(255, 255, 255)):
    draw.text((x, y), text, font=font, fill=fill)


def draw_text_center(draw, rect, text, font, fill=(255, 255, 255)):
    x1, y1, x2, y2 = rect
    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    x = x1 + (x2 - x1 - text_w) // 2
    y = y1 + (y2 - y1 - text_h) // 2 - 2
    draw.text((x, y), text, font=font, fill=fill)


def overlay_transparent_rounded_rect(frame, rect, color, alpha=0.65, radius=22,
                                     border_color=None, border_thickness=2):
    """
    在 OpenCV 图像上绘制半透明圆角矩形
    rect: (x1, y1, x2, y2)
    color: BGR
    """
    x1, y1, x2, y2 = rect
    overlay = frame.copy()

    # 中间矩形
    cv2.rectangle(overlay, (x1 + radius, y1), (x2 - radius, y2), color, -1)
    cv2.rectangle(overlay, (x1, y1 + radius), (x2, y2 - radius), color, -1)

    # 四角圆
    cv2.circle(overlay, (x1 + radius, y1 + radius), radius, color, -1)
    cv2.circle(overlay, (x2 - radius, y1 + radius), radius, color, -1)
    cv2.circle(overlay, (x1 + radius, y2 - radius), radius, color, -1)
    cv2.circle(overlay, (x2 - radius, y2 - radius), radius, color, -1)

    # 透明叠加
    frame = cv2.addWeighted(overlay, alpha, frame, 1 - alpha, 0)

    # 边框
    if border_color is not None and border_thickness > 0:
        cv2.ellipse(frame, (x1 + radius, y1 + radius), (radius, radius), 180, 0, 90, border_color, border_thickness)
        cv2.ellipse(frame, (x2 - radius, y1 + radius), (radius, radius), 270, 0, 90, border_color, border_thickness)
        cv2.ellipse(frame, (x1 + radius, y2 - radius), (radius, radius), 90, 0, 90, border_color, border_thickness)
        cv2.ellipse(frame, (x2 - radius, y2 - radius), (radius, radius), 0, 0, 90, border_color, border_thickness)

        cv2.line(frame, (x1 + radius, y1), (x2 - radius, y1), border_color, border_thickness)
        cv2.line(frame, (x1 + radius, y2), (x2 - radius, y2), border_color, border_thickness)
        cv2.line(frame, (x1, y1 + radius), (x1, y2 - radius), border_color, border_thickness)
        cv2.line(frame, (x2, y1 + radius), (x2, y2 - radius), border_color, border_thickness)

    return frame


def resize_for_display(frame, max_width=1280, max_height=720):
    """
    仅用于显示，避免 Windows 下高分屏只显示左上角
    """
    global display_scale

    h, w = frame.shape[:2]
    scale = min(max_width / w, max_height / h)
    scale = min(scale, 1.0)  # 只缩小不放大
    display_scale = scale

    new_w = int(w * scale)
    new_h = int(h * scale)

    if scale < 1.0:
        frame = cv2.resize(frame, (new_w, new_h), interpolation=cv2.INTER_AREA)

    return frame


# ===================== UI 绘制 =====================
def draw_buttons(frame):
    # 截图按钮
    frame = overlay_transparent_rounded_rect(
        frame,
        (BTN1_X1, BTN1_Y1, BTN1_X2, BTN1_Y2),
        color=(0, 170, 0),
        alpha=0.60,
        radius=22,
        border_color=(255, 255, 255),
        border_thickness=2
    )

    # 录制按钮
    btn2_color = (0, 0, 230) if not is_recording else (220, 80, 0)
    frame = overlay_transparent_rounded_rect(
        frame,
        (BTN2_X1, BTN2_Y1, BTN2_X2, BTN2_Y2),
        color=btn2_color,
        alpha=0.60,
        radius=22,
        border_color=(255, 255, 255),
        border_thickness=2
    )

    frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    frame_pil = Image.fromarray(frame_rgb)
    draw = ImageDraw.Draw(frame_pil)
    font_btn = get_chinese_font(34)

    draw_text_center(draw, (BTN1_X1, BTN1_Y1, BTN1_X2, BTN1_Y2), "截图", font_btn)
    draw_text_center(draw, (BTN2_X1, BTN2_Y1, BTN2_X2, BTN2_Y2), "录制" if not is_recording else "停止", font_btn)

    return cv2.cvtColor(np.array(frame_pil), cv2.COLOR_RGB2BGR)


def draw_recording_status(frame):
    if not is_recording or record_start_time is None:
        return frame

    elapsed = time.time() - record_start_time
    time_text = format_seconds(elapsed)

    panel_x1, panel_y1, panel_x2, panel_y2 = 30, 130, 270, 195

    frame = overlay_transparent_rounded_rect(
        frame,
        (panel_x1, panel_y1, panel_x2, panel_y2),
        color=(20, 20, 20),
        alpha=0.55,
        radius=18,
        border_color=(255, 255, 255),
        border_thickness=1
    )

    # 红点闪烁
    blink_on = int(elapsed * 2) % 2 == 0
    if blink_on:
        cv2.circle(frame, (panel_x1 + 28, panel_y1 + 31), 9, (0, 0, 255), -1)

    frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    frame_pil = Image.fromarray(frame_rgb)
    draw = ImageDraw.Draw(frame_pil)

    font_label = get_chinese_font(24)
    font_time = get_chinese_font(26)

    draw_text(draw, panel_x1 + 48, panel_y1 + 16, "录制中", font_label, fill=(255, 255, 255))
    draw_text(draw, panel_x1 + 20, panel_y1 + 38, time_text, font_time, fill=(255, 230, 230))

    return cv2.cvtColor(np.array(frame_pil), cv2.COLOR_RGB2BGR)


# ===================== 录制控制 =====================
def start_recording():
    global is_recording, video_writer, cap, record_start_time, record_output_file

    if cap is None:
        print("❌ 摄像头未初始化")
        return

    fps = cap.get(cv2.CAP_PROP_FPS)
    if fps is None or fps <= 1 or fps > 120:
        fps = 20.0

    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    if width <= 0 or height <= 0:
        print("❌ 无法获取视频尺寸")
        return

    fourcc, output_file = get_video_output_config()
    writer = cv2.VideoWriter(output_file, fourcc, fps, (width, height))

    if not writer.isOpened():
        print("❌ 视频写入器创建失败，可能缺少对应编码支持")
        return

    video_writer = writer
    is_recording = True
    record_start_time = time.time()
    record_output_file = output_file

    print(f"🔴 开始录制视频：{output_file}")


def stop_recording():
    global is_recording, video_writer, record_start_time, record_output_file

    if video_writer is not None:
        video_writer.release()
        video_writer = None

    output_file = record_output_file
    is_recording = False
    record_start_time = None
    record_output_file = None

    if output_file:
        print(f"⏹️ 录制完成：{output_file}")
    else:
        print("⏹️ 录制完成")


# ===================== 鼠标点击 =====================
def mouse_click(event, x, y, flags, param):
    global screenshot_num, current_frame, display_scale

    if event != cv2.EVENT_LBUTTONDOWN:
        return

    # 将显示坐标映射回原始视频坐标
    if display_scale > 0:
        real_x = int(x / display_scale)
        real_y = int(y / display_scale)
    else:
        real_x, real_y = x, y

    # 截图
    if BTN1_X1 < real_x < BTN1_X2 and BTN1_Y1 < real_y < BTN1_Y2:
        if current_frame is not None:
            img_name = get_screenshot_filename(screenshot_num)
            ok = cv2.imwrite(img_name, current_frame)
            if ok:
                print(f"✅ 截图成功：{img_name}")
                screenshot_num += 1
            else:
                print("❌ 截图保存失败")

    # 录制 / 停止
    elif BTN2_X1 < real_x < BTN2_X2 and BTN2_Y1 < real_y < BTN2_Y2:
        if not is_recording:
            start_recording()
        else:
            stop_recording()


# ===================== 打开摄像头 =====================
def create_capture(rtsp_url):
    os_name = get_os_name()

    # Windows 优先 FFMPEG
    if os_name == "windows":
        cap_obj = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)
        if cap_obj.isOpened():
            return cap_obj

    return cv2.VideoCapture(rtsp_url)


# ===================== 主函数 =====================
def view_camera():
    global cap, current_frame, video_writer, is_recording, record_start_time, record_output_file

    cap = create_capture(RTSP_URL)

    if not cap.isOpened():
        print("❌ 无法连接摄像头，请检查：")
        print("   1. 网络是否连通")
        print("   2. RTSP 地址、账号密码是否正确")
        print("   3. 摄像头是否开启 RTSP 协议")
        print("   4. OpenCV 是否支持 FFmpeg / RTSP")
        return

    print("✅ 成功连接摄像头！")
    print(f"💻 当前系统：{platform.system()}")
    print("🖱️ 点击顶部按钮操作")
    print("   左侧按钮：截图")
    print("   右侧按钮：开始/停止录制")
    print("⌨️ 按 q 键退出程序\n")

    cv2.namedWindow(WINDOW_NAME, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(WINDOW_NAME, DISPLAY_MAX_WIDTH, DISPLAY_MAX_HEIGHT)
    cv2.setMouseCallback(WINDOW_NAME, mouse_click)

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                print("⚠️ 无法获取视频帧，连接可能中断")
                break

            # 原始帧用于截图和录制
            current_frame = frame.copy()

            # UI绘制基于原始帧
            show_frame = frame.copy()
            show_frame = draw_buttons(show_frame)
            show_frame = draw_recording_status(show_frame)

            # 缩放后的帧仅用于显示
            display_frame = resize_for_display(
                show_frame,
                DISPLAY_MAX_WIDTH,
                DISPLAY_MAX_HEIGHT
            )

            cv2.imshow(WINDOW_NAME, display_frame)

            # 录制写入原始分辨率帧
            if is_recording and video_writer is not None:
                video_writer.write(current_frame)

            key = cv2.waitKey(1) & 0xFF
            if key == ord("q"):
                break

    finally:
        if cap is not None:
            cap.release()
            cap = None

        if video_writer is not None:
            video_writer.release()
            video_writer = None

        is_recording = False
        record_start_time = None
        record_output_file = None

        cv2.destroyAllWindows()
        print("🔚 程序已退出")


if __name__ == "__main__":
    view_camera()