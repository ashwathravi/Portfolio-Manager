"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, Tag as TagIcon } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useSettingsStore, type Tag } from "@/lib/stores/settingsStore";
import { tagSchema, type TagFormValues } from "@/lib/validators/settings";
import { toast } from "sonner";

const PRESET_COLORS = [
    "#17cf54", // green (primary)
    "#3b82f6", // blue
    "#f59e0b", // amber
    "#ef4444", // red
    "#8b5cf6", // purple
    "#ec4899", // pink
    "#06b6d4", // cyan
    "#f97316", // orange
    "#14b8a6", // teal
    "#6366f1", // indigo
];

export function TagsManager() {
    const tags = useSettingsStore((s) => s.tags);
    const addTag = useSettingsStore((s) => s.addTag);
    const updateTag = useSettingsStore((s) => s.updateTag);
    const deleteTag = useSettingsStore((s) => s.deleteTag);

    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingTag, setEditingTag] = useState<Tag | null>(null);
    const [selectedColor, setSelectedColor] = useState(PRESET_COLORS[0]);

    const {
        register,
        handleSubmit,
        reset,
        setValue,
        watch,
        formState: { errors },
    } = useForm<TagFormValues>({
        resolver: zodResolver(tagSchema),
        defaultValues: {
            name: "",
            color: PRESET_COLORS[0],
        },
    });

    const watchedName = watch("name");
    const watchedColor = watch("color");

    const openAddDialog = () => {
        setEditingTag(null);
        setSelectedColor(PRESET_COLORS[0]);
        reset({ name: "", color: PRESET_COLORS[0] });
        setDialogOpen(true);
    };

    const openEditDialog = (tag: Tag) => {
        setEditingTag(tag);
        setSelectedColor(tag.color);
        reset({ name: tag.name, color: tag.color });
        setDialogOpen(true);
    };

    const handleColorSelect = (color: string) => {
        setSelectedColor(color);
        setValue("color", color, { shouldValidate: true });
    };

    const onSubmit = (data: TagFormValues) => {
        if (editingTag) {
            updateTag(editingTag.id, data);
            toast.success(`Tag "${data.name}" updated`);
        } else {
            addTag(data);
            toast.success(`Tag "${data.name}" created`);
        }
        setDialogOpen(false);
        reset();
    };

    const handleDelete = (tag: Tag) => {
        deleteTag(tag.id);
        toast.success(`Tag "${tag.name}" deleted`);
    };

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <div>
                    <CardTitle>Tags</CardTitle>
                    <CardDescription className="mt-1.5">
                        Organize your assets with custom tags and color labels.
                    </CardDescription>
                </div>
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogTrigger asChild>
                        <Button size="sm" onClick={openAddDialog}>
                            <Plus className="h-4 w-4 mr-1.5" />
                            Add Tag
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>
                                {editingTag ? "Edit Tag" : "Create New Tag"}
                            </DialogTitle>
                            <DialogDescription>
                                {editingTag
                                    ? "Update the tag name and color."
                                    : "Add a new tag to organize your assets."}
                            </DialogDescription>
                        </DialogHeader>
                        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="tag-name">Tag Name</Label>
                                <Input
                                    id="tag-name"
                                    placeholder="e.g., Growth, Value, Tech"
                                    {...register("name")}
                                />
                                {errors.name && (
                                    <p className="text-sm text-destructive">{errors.name.message}</p>
                                )}
                            </div>

                            <div className="space-y-2">
                                <Label>Color</Label>
                                <div className="flex flex-wrap gap-2">
                                    {PRESET_COLORS.map((color) => (
                                        <button
                                            key={color}
                                            type="button"
                                            onClick={() => handleColorSelect(color)}
                                            className={`h-8 w-8 rounded-full border-2 transition-all ${
                                                selectedColor === color
                                                    ? "border-foreground scale-110"
                                                    : "border-transparent hover:scale-105"
                                            }`}
                                            style={{ backgroundColor: color }}
                                            aria-label={`Select color ${color}`}
                                        />
                                    ))}
                                </div>
                                <div className="flex items-center gap-2 mt-2">
                                    <Label htmlFor="hex-color" className="text-xs text-muted-foreground whitespace-nowrap">
                                        Custom hex:
                                    </Label>
                                    <Input
                                        id="hex-color"
                                        {...register("color")}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            setValue("color", val, { shouldValidate: true });
                                            if (/^#[0-9a-fA-F]{6}$/.test(val)) {
                                                setSelectedColor(val);
                                            }
                                        }}
                                        placeholder="#17cf54"
                                        className="font-mono text-sm h-8"
                                    />
                                </div>
                                {errors.color && (
                                    <p className="text-sm text-destructive">{errors.color.message}</p>
                                )}
                            </div>

                            {/* Live Preview */}
                            <div className="space-y-2">
                                <Label className="text-xs text-muted-foreground">Preview</Label>
                                <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg">
                                    <div
                                        className="h-3 w-3 rounded-full flex-shrink-0"
                                        style={{ backgroundColor: watchedColor }}
                                    />
                                    <Badge
                                        variant="secondary"
                                        style={{
                                            backgroundColor: `${watchedColor}20`,
                                            color: watchedColor,
                                            borderColor: `${watchedColor}40`,
                                        }}
                                        className="border"
                                    >
                                        {watchedName || "Tag Name"}
                                    </Badge>
                                </div>
                            </div>

                            <DialogFooter>
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => setDialogOpen(false)}
                                >
                                    Cancel
                                </Button>
                                <Button type="submit">
                                    {editingTag ? "Save Changes" : "Create Tag"}
                                </Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>
            </CardHeader>
            <CardContent>
                {tags.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                        <TagIcon className="h-10 w-10 text-muted-foreground/50 mb-3" />
                        <p className="text-sm font-medium text-muted-foreground">No tags yet</p>
                        <p className="text-xs text-muted-foreground/70 mt-1">
                            Create your first tag to start organizing assets.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        <AnimatePresence mode="popLayout">
                            {tags.map((tag) => (
                                <motion.div
                                    key={tag.id}
                                    layout
                                    initial={{ opacity: 0, y: -10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, x: -20 }}
                                    transition={{ duration: 0.2 }}
                                    className="flex items-center justify-between p-3 border rounded-lg"
                                >
                                    <div className="flex items-center gap-3">
                                        <div
                                            className="h-4 w-4 rounded-full flex-shrink-0"
                                            style={{ backgroundColor: tag.color }}
                                        />
                                        <span className="font-medium text-sm">{tag.name}</span>
                                        <Badge
                                            variant="secondary"
                                            className="border text-xs"
                                            style={{
                                                backgroundColor: `${tag.color}20`,
                                                color: tag.color,
                                                borderColor: `${tag.color}40`,
                                            }}
                                        >
                                            {tag.name}
                                        </Badge>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-8 w-8 p-0"
                                            onClick={() => openEditDialog(tag)}
                                        >
                                            <Pencil className="h-3.5 w-3.5" />
                                            <span className="sr-only">Edit {tag.name}</span>
                                        </Button>
                                        <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                    <span className="sr-only">Delete {tag.name}</span>
                                                </Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent>
                                                <AlertDialogHeader>
                                                    <AlertDialogTitle>Delete tag &ldquo;{tag.name}&rdquo;?</AlertDialogTitle>
                                                    <AlertDialogDescription>
                                                        This will remove the tag from all associated assets. This action cannot be undone.
                                                    </AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter>
                                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                    <AlertDialogAction
                                                        onClick={() => handleDelete(tag)}
                                                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                                    >
                                                        Delete
                                                    </AlertDialogAction>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                    </div>
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
