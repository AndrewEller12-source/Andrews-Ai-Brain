import AppKit
import Foundation

let root = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "apple")
func drawIcon(size: Int, rounded: Bool) -> Data {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
    let transform = NSAffineTransform(); transform.scale(by: CGFloat(size) / 1024); transform.concat()
    let rect = rounded ? NSRect(x: 36, y: 36, width: 952, height: 952) : NSRect(x: 0, y: 0, width: 1024, height: 1024)
    let background = NSBezierPath(roundedRect: rect, xRadius: rounded ? 205 : 0, yRadius: rounded ? 205 : 0)
    NSColor(calibratedRed: 0.025, green: 0.055, blue: 0.14, alpha: 1).setFill(); background.fill()
    background.addClip()
    let cyan = NSColor(calibratedRed: 0.15, green: 0.86, blue: 0.99, alpha: 1)
    let blue = NSColor(calibratedRed: 0.25, green: 0.45, blue: 0.99, alpha: 1)
    // Two asymmetric hemispheres formed from living branches and deliberate node endpoints.
    let branches: [(NSPoint, NSPoint, NSPoint)] = [
        (NSPoint(x: 475,y: 512),NSPoint(x: 258,y: 690),NSPoint(x: 364,y: 786)),
        (NSPoint(x: 475,y: 512),NSPoint(x: 188,y: 556),NSPoint(x: 228,y: 610)),
        (NSPoint(x: 475,y: 512),NSPoint(x: 247,y: 399),NSPoint(x: 247,y: 426)),
        (NSPoint(x: 475,y: 512),NSPoint(x: 342,y: 260),NSPoint(x: 353,y: 291)),
        (NSPoint(x: 549,y: 512),NSPoint(x: 766,y: 690),NSPoint(x: 660,y: 786)),
        (NSPoint(x: 549,y: 512),NSPoint(x: 836,y: 556),NSPoint(x: 796,y: 610)),
        (NSPoint(x: 549,y: 512),NSPoint(x: 777,y: 399),NSPoint(x: 777,y: 426)),
        (NSPoint(x: 549,y: 512),NSPoint(x: 682,y: 260),NSPoint(x: 671,y: 291))
    ]
    for (index, branch) in branches.enumerated() {
        let line = NSBezierPath(); line.move(to: branch.0); line.curve(to: branch.1, controlPoint1: NSPoint(x: branch.0.x,y: branch.2.y), controlPoint2: branch.2)
        line.lineCapStyle = .round; line.lineJoinStyle = .round
        (index < 4 ? cyan : blue).withAlphaComponent(0.12).setStroke(); line.lineWidth = 38; line.stroke()
        (index < 4 ? cyan : blue).setStroke(); line.lineWidth = 11; line.stroke()
        let point = branch.1
        (index < 4 ? cyan : blue).setFill(); NSBezierPath(ovalIn: NSRect(x: point.x-23,y: point.y-23,width: 46,height: 46)).fill()
    }
    let spine = NSBezierPath(); spine.move(to: NSPoint(x: 512,y: 230)); spine.line(to: NSPoint(x: 512,y: 788)); spine.lineCapStyle = .round; spine.lineWidth = 8; cyan.withAlphaComponent(0.48).setStroke(); spine.stroke()
    cyan.withAlphaComponent(0.09).setFill(); NSBezierPath(ovalIn: NSRect(x: 405,y: 405,width: 214,height: 214)).fill()
    cyan.withAlphaComponent(0.16).setFill(); NSBezierPath(ovalIn: NSRect(x: 437,y: 437,width: 150,height: 150)).fill()
    NSColor(calibratedRed: 0.83,green: 0.99,blue: 1,alpha: 1).setFill(); NSBezierPath(ovalIn: NSRect(x: 473,y: 473,width: 78,height: 78)).fill()
    NSGraphicsContext.restoreGraphicsState()
    return bitmap.representation(using: .png, properties: [:])!
}
let jsonEncoder = JSONEncoder(); jsonEncoder.outputFormatting = [.prettyPrinted, .sortedKeys]
var macImages: [[String:String]] = []
for points in [16,32,128,256,512] {
    for scale in [1,2] {
        let filename = "icon-\(points)@\(scale)x.png"
        try drawIcon(size: points*scale,rounded: true).write(to: root.appendingPathComponent("Mac/Assets.xcassets/AppIcon.appiconset/\(filename)"))
        macImages.append(["filename":filename,"idiom":"mac","size":"\(points)x\(points)","scale":"\(scale)x"])
    }
}
try drawIcon(size: 1024,rounded: false).write(to: root.appendingPathComponent("iPhone/Assets.xcassets/AppIcon.appiconset/icon-1024.png"))
for (folder,images) in [("Mac",macImages),("iPhone",[["filename":"icon-1024.png","idiom":"universal","platform":"ios","size":"1024x1024"]])] {
    let data = try JSONSerialization.data(withJSONObject: ["images":images,"info":["author":"xcode","version":1]], options: [.prettyPrinted,.sortedKeys])
    try data.write(to: root.appendingPathComponent("\(folder)/Assets.xcassets/AppIcon.appiconset/Contents.json"))
    try Data("{\"info\":{\"author\":\"xcode\",\"version\":1}}".utf8).write(to: root.appendingPathComponent("\(folder)/Assets.xcassets/Contents.json"))
}
