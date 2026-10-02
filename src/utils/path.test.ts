import { describe, it, expect } from "vitest";
import {
  sepOf,
  join,
  dirname,
  basename,
  isInside,
  rebase,
  validateName,
} from "./path";

describe("path utilities", () => {
  describe("sepOf", () => {
    it("detects Windows separators from drive letters or backslashes", () => {
      expect(sepOf("C:\\Users\\student\\project")).toBe("\\");
      expect(sepOf("d:/java/main.java")).toBe("\\");
      expect(sepOf("C:")).toBe("\\");
    });

    it("detects Unix separators", () => {
      expect(sepOf("/home/user/project")).toBe("/");
      expect(sepOf("relative/path/to/file")).toBe("/");
    });
  });

  describe("join", () => {
    it("joins Windows paths without duplicating separators", () => {
      expect(join("C:\\project", "main.java")).toBe("C:\\project\\main.java");
      expect(join("C:\\project\\", "\\main.java")).toBe("C:\\project\\main.java");
      expect(join("C:\\folder with spaces", "nested file.c")).toBe("C:\\folder with spaces\\nested file.c");
    });

    it("joins Unix paths without duplicating separators", () => {
      expect(join("/home/user", "project")).toBe("/home/user/project");
      expect(join("/home/user/", "/project/")).toBe("/home/user/project/");
    });
  });

  describe("dirname and basename", () => {
    it("extracts directory and basename from Windows paths", () => {
      expect(dirname("C:\\Users\\student\\project\\main.java")).toBe("C:\\Users\\student\\project");
      expect(basename("C:\\Users\\student\\project\\main.java")).toBe("main.java");
      expect(dirname("C:\\file.txt")).toBe("C:\\");
      expect(basename("C:\\file.txt")).toBe("file.txt");
    });

    it("extracts directory and basename from Unix paths", () => {
      expect(dirname("/home/user/project/main.c")).toBe("/home/user/project");
      expect(basename("/home/user/project/main.c")).toBe("main.c");
      expect(dirname("/root")).toBe("/");
      expect(basename("/root")).toBe("root");
    });
  });

  describe("isInside", () => {
    it("correctly identifies child inside ancestor on Windows (case-insensitive)", () => {
      expect(isInside("C:\\Project\\src\\Main.java", "C:\\project")).toBe(true);
      expect(isInside("C:\\Project\\src\\Main.java", "c:\\project\\src")).toBe(true);
      expect(isInside("C:\\Project\\src\\Main.java", "C:\\Project\\src\\Main.java")).toBe(true);
      expect(isInside("C:\\Project2\\Main.java", "C:\\Project")).toBe(false);
      expect(isInside("D:\\Project\\Main.java", "C:\\Project")).toBe(false);
    });

    it("correctly identifies child inside ancestor on Unix (case-sensitive)", () => {
      expect(isInside("/home/user/project/main.c", "/home/user/project")).toBe(true);
      expect(isInside("/home/user/project2/main.c", "/home/user/project")).toBe(false);
    });
  });

  describe("rebase", () => {
    it("rebases paths when parent folder is renamed on Windows", () => {
      expect(
        rebase("C:\\code\\project\\src\\main.java", "C:\\code\\project", "C:\\code\\new_proj")
      ).toBe("C:\\code\\new_proj\\src\\main.java");

      expect(
        rebase("C:\\code\\project", "C:\\code\\project", "C:\\code\\new_proj")
      ).toBe("C:\\code\\new_proj");
    });

    it("rebases paths when parent folder is renamed on Unix", () => {
      expect(
        rebase("/home/u/work/src/app.py", "/home/u/work", "/home/u/renamed")
      ).toBe("/home/u/renamed/src/app.py");
    });
  });

  describe("validateName", () => {
    it("accepts valid filenames", () => {
      expect(validateName("main.java")).toBeNull();
      expect(validateName("hello_world.c")).toBeNull();
      expect(validateName("test-file 123.py")).toBeNull();
      expect(validateName("unicode_αβγ.txt")).toBeNull();
    });

    it("rejects empty names or whitespace", () => {
      expect(validateName("")).not.toBeNull();
      expect(validateName("   ")).not.toBeNull();
    });

    it("rejects . and ..", () => {
      expect(validateName(".")).not.toBeNull();
      expect(validateName("..")).not.toBeNull();
    });

    it("rejects illegal characters", () => {
      expect(validateName("foo/bar")).not.toBeNull();
      expect(validateName("foo\\bar")).not.toBeNull();
      expect(validateName("foo:bar")).not.toBeNull();
      expect(validateName("foo*bar")).not.toBeNull();
      expect(validateName("foo?bar")).not.toBeNull();
      expect(validateName('foo"bar')).not.toBeNull();
      expect(validateName("foo<bar")).not.toBeNull();
      expect(validateName("foo>bar")).not.toBeNull();
      expect(validateName("foo|bar")).not.toBeNull();
    });

    it("rejects trailing dot or space", () => {
      expect(validateName("test.")).not.toBeNull();
      expect(validateName("test ")).not.toBeNull();
    });

    it("rejects Windows reserved device names", () => {
      expect(validateName("con")).not.toBeNull();
      expect(validateName("CON.txt")).not.toBeNull();
      expect(validateName("aux.java")).not.toBeNull();
      expect(validateName("NUL")).not.toBeNull();
      expect(validateName("prn")).not.toBeNull();
      expect(validateName("com1.dat")).not.toBeNull();
      expect(validateName("lpt2")).not.toBeNull();
    });
  });
});
