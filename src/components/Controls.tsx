import React, { useEffect, useRef, useMemo } from 'react';
import { PlacedBox, ScaleShape, Key, ScaleType, EnharmonicMode } from '../types';
import { TrashIcon } from './icons/TrashIcon';
import ShapeIcon from './icons/ShapeIcon';
import { PlusCircleIcon } from './icons/PlusCircleIcon';
import { useCustomData } from './useCustomTypes';

interface ShapeControlsProps {
  placedBoxes: PlacedBox[];
  availableShapes: ScaleShape[];
  // FIX: Changed to Partial to match the type of ALL_SHAPES constant.
  allShapes: Partial<Record<ScaleType, ScaleShape[]>>;
  selectedKey: Key | null;
  onRemoveBox: (boxId: string) => void;
  onUpdateShapePosition: (boxId: string, fret: number) => void;
  activeBoxId: string | null;
  onSelectBox: (boxId: string | null) => void;
  onAddShapeInKey: (shapeIndex: number) => void;
  scaleType: ScaleType;
}

interface ControlsProps {
  selectedKey: Key | null;
  scaleType: ScaleType;
  onScaleTypeChange: (type: ScaleType) => void;
  onKeyChange: (key: Key | null) => void;
  isModeLocked: boolean;
  enharmonicMode: EnharmonicMode;
  onEnharmonicModeChange: (mode: EnharmonicMode) => void;
}

const ScaleTypeSelector: React.FC<{ scaleType: ScaleType; onScaleTypeChange: (type: ScaleType) => void; }> = ({ scaleType, onScaleTypeChange }) => {
    const { customScales } = useCustomData();
    
    return (
      <div>
        <h2 className="text-base font-bold mb-2 border-b border-gray-600 pb-1">Scale Type</h2>
        <select
          value={scaleType}
          onChange={(e) => onScaleTypeChange(e.target.value as ScaleType)}
          className="w-full bg-gray-700 border border-gray-600 rounded-md p-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          aria-label="Scale type"
        >
          <option value="Pentatonic">Pentatonic</option>
          <optgroup label="Major Scale Modes">
            <option value="Ionian">Ionian (Major)</option>
            <option value="Dorian">Dorian</option>
            <option value="Phrygian">Phrygian</option>
            <option value="Lydian">Lydian</option>
            <option value="Mixolydian">Mixolydian</option>
            <option value="Aeolian">Aeolian (Natural Minor)</option>
            <option value="Locrian">Locrian</option>
          </optgroup>
          <optgroup label="Harmonic Minor Modes">
            <option value="Harmonic Minor">Harmonic Minor</option>
            <option value="Locrian #6">Locrian #6</option>
            <option value="Ionian #5">Ionian #5</option>
            <option value="Dorian #4">Dorian #4</option>
            <option value="Phrygian Dominant">Phrygian Dominant</option>
            <option value="Lydian #2">Lydian #2</option>
            <option value="Altered Dominant bb7">Altered Dominant bb7</option>
          </optgroup>
          <optgroup label="Melodic Minor Modes">
            <option value="Melodic Minor">Melodic Minor</option>
            <option value="Dorian b2">Dorian b2</option>
            <option value="Lydian Augmented">Lydian Augmented</option>
            <option value="Lydian Dominant">Lydian Dominant</option>
            <option value="Mixolydian b6">Mixolydian b6</option>
            <option value="Locrian #2">Locrian #2</option>
            <option value="Altered Scale">Altered Scale (Super Locrian)</option>
          </optgroup>
          {customScales.length > 0 && (
            <optgroup label="Scale Personalizzate">
                {customScales.map(scale => (
                    <option key={scale.name} value={scale.name}>{scale.name}</option>
                ))}
            </optgroup>
          )}
        </select>
      </div>
    );
};

const PlacedShapeItem: React.FC<{
    placedBox: PlacedBox;
    shape: ScaleShape;
    isSelected: boolean;
    onClick: () => void;
    onRemoveBox: (id: string) => void;
    onUpdateShapePosition: (id: string, fret: number) => void;
    isKeySelected: boolean;
    itemRef: (el: HTMLDivElement | null) => void;
}> = ({ placedBox, shape, isSelected, onClick, onRemoveBox, onUpdateShapePosition, isKeySelected, itemRef }) => (
    <div
        ref={itemRef}
        onClick={onClick}
        className={`
            relative rounded-md p-1 pl-2 text-sm cursor-pointer 
            transition-all duration-200
            border
            ${isSelected 
                ? 'bg-gray-600 border-blue-500' 
                : 'bg-gray-700 border-transparent hover:border-gray-500'
            }
        `}
    >
        <div 
            className="absolute left-0 top-0 h-full w-1 rounded-l-md"
            style={{ backgroundColor: shape.color }}
        ></div>
        <div className="flex justify-between items-center gap-2 ml-1">
             <ShapeIcon notes={shape.notes} color={shape.color} />
             <div className="flex-grow">
                  <span className="font-semibold text-xs">{shape.name}</span>
             </div>
            <div className="flex items-center gap-1">
                <label htmlFor={`fret-${placedBox.id}`} className="text-[10px] text-gray-400">Fret:</label>
                <input
                    type="number"
                    id={`fret-${placedBox.id}`}
                    value={placedBox.fretPosition}
                    onChange={(e) => onUpdateShapePosition(placedBox.id, parseInt(e.target.value, 10) || 0)}
                    className="w-10 bg-gray-800 border border-gray-600 rounded py-0 px-1 text-center text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-900/50 disabled:text-gray-500 disabled:cursor-not-allowed"
                    min="0"
                    disabled={isKeySelected}
                    onClick={(e) => e.stopPropagation()}
                />
            </div>
            <button 
                onClick={(e) => { e.stopPropagation(); onRemoveBox(placedBox.id); }} 
                className="text-gray-400 hover:text-red-500 transition-colors p-0.5 rounded-full hover:bg-gray-800/50"
                title="Remove shape"
            >
                <TrashIcon />
            </button>
        </div>
    </div>
);


export const ShapeControls: React.FC<ShapeControlsProps> = ({
  placedBoxes,
  availableShapes,
  allShapes,
  selectedKey,
  onRemoveBox,
  onUpdateShapePosition,
  activeBoxId,
  onSelectBox,
  onAddShapeInKey,
  scaleType
}) => {
    const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());

    const placedShapeIndicesInKey = useMemo(() => 
        new Set(placedBoxes.filter(b => b.scaleType === scaleType).map(b => b.shapeIndex)), 
    [placedBoxes, scaleType]);

    return (
        <div className="bg-gray-800 rounded-lg shadow-xl p-4 w-full max-w-sm">
            <div className="flex flex-col flex-grow min-h-0">
                <h2 className="text-base font-bold mb-2 border-b border-gray-600 pb-1">Scale Shapes</h2>
                <div className="grid grid-cols-2 gap-2 flex-grow overflow-y-auto pr-2 -mr-2 max-h-60">
                    {availableShapes.map((shape, index) => {
                        const placedBox = placedBoxes.find(b => b.shapeIndex === index && b.scaleType === scaleType);
                        if (placedBox) {
                            return (
                                <PlacedShapeItem
                                    key={placedBox.id}
                                    placedBox={placedBox}
                                    shape={shape}
                                    isSelected={placedBox.id === activeBoxId}
                                    onClick={() => onSelectBox(placedBox.id === activeBoxId ? null : placedBox.id)}
                                    onRemoveBox={onRemoveBox}
                                    onUpdateShapePosition={onUpdateShapePosition}
                                    isKeySelected={!!selectedKey}
                                    itemRef={el => {
                                        if (el) itemRefs.current.set(placedBox.id, el as HTMLDivElement);
                                        else itemRefs.current.delete(placedBox.id);
                                    }}
                                />
                            );
                        }

                        // If no key is selected, keep the grid stable by showing a disabled placeholder.
                        if (!selectedKey) {
                            return (
                                <div
                                    key={`shape-placeholder-${index}`}
                                    className="relative w-full h-full text-left p-1 pl-2 rounded-md bg-gray-900/40 text-gray-500 text-sm border border-gray-800 cursor-not-allowed"
                                    title="Seleziona una tonalità per aggiungere una shape"
                                >
                                    <div
                                        className="absolute left-0 top-0 h-full w-1 rounded-l-md"
                                        style={{ backgroundColor: shape.color, opacity: 0.35 }}
                                    ></div>
                                    <div className="flex justify-between items-center gap-2 ml-1">
                                        <ShapeIcon notes={shape.notes} color={shape.color} />
                                        <div className="flex-grow">
                                            <span className="font-semibold text-xs">{shape.name}</span>
                                        </div>
                                    </div>
                                </div>
                            );
                        }

                        // Key selected: offer to add this shape if not already placed.
                        return (
                            <button
                                key={`add-shape-${index}`}
                                onClick={() => onAddShapeInKey(index)}
                                className="relative w-full h-full text-left p-1 pl-2 rounded-md bg-gray-700 hover:bg-gray-600 transition-colors text-white text-sm border border-transparent hover:border-gray-500"
                            >
                                <div
                                    className="absolute left-0 top-0 h-full w-1 rounded-l-md"
                                    style={{ backgroundColor: shape.color }}
                                ></div>
                                <div className="flex justify-between items-center gap-2 ml-1">
                                    <ShapeIcon notes={shape.notes} color={shape.color} />
                                    <div className="flex-grow">
                                        <span className="font-semibold text-xs">{shape.name}</span>
                                    </div>
                                    <div className="text-green-400">
                                        <PlusCircleIcon />
                                    </div>
                                </div>
                            </button>
                        );
                    })}
                    
                    {placedBoxes.length === 0 && !selectedKey && (
                        <div className="col-span-2 text-gray-400 p-3 text-center text-sm">
                            No shapes placed. Click a fret and press a number key (1-{availableShapes.length}) to place a shape.
                        </div>
                    )}

                    {placedBoxes.length === 0 && selectedKey && (
                        <div className="col-span-2 text-gray-400 p-3 text-center text-sm">
                            No shapes added. Add shapes using the buttons or number keys (1-{availableShapes.length}).
                        </div>
                    )}

                    {availableShapes.length === 0 && (
                        <div className="col-span-2 text-gray-400 p-3 text-center text-sm">
                            No shapes available for this scale type.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const Controls: React.FC<ControlsProps> = ({
  selectedKey,
  scaleType,
  onScaleTypeChange,
  onKeyChange,
  isModeLocked,
  enharmonicMode,
  onEnharmonicModeChange,
}) => {
  const handleScaleModeChange = (mode: 'Major' | 'Minor') => {
      if (!selectedKey) return;
      onKeyChange({
          ...selectedKey,
          scale: mode,
      });
  };

  return (
    <div className="bg-gray-800 rounded-lg shadow-xl p-4 flex flex-col gap-4 h-full w-full max-w-sm">
      <ScaleTypeSelector scaleType={scaleType} onScaleTypeChange={onScaleTypeChange} />
      
      <div>
        <h2 className="text-base font-bold mb-2 border-b border-gray-600 pb-1">Key & Quality</h2>
        <div className="flex flex-col items-center gap-4">
            {selectedKey ? (
              <>
                <div className="w-full flex justify-center gap-2">
                     <div className="relative flex w-full max-w-[200px] p-1 bg-gray-700 rounded-lg">
                        <div 
                            className="absolute top-1 left-1 h-[calc(100%-8px)] w-[calc(50%-4px)] bg-stone-200 rounded-md transition-transform duration-300 ease-in-out"
                            style={{ transform: `translateX(${selectedKey.scale === 'Major' ? '0%' : '100%'}) ` }}
                        ></div>
                        <button 
                            onClick={() => handleScaleModeChange('Major')}
                            disabled={isModeLocked}
                            className={`relative w-1/2 rounded-md py-2 text-sm font-bold transition-colors duration-300 ${selectedKey.scale === 'Major' ? 'text-gray-900' : 'text-gray-300 hover:text-white'} ${isModeLocked ? 'cursor-not-allowed' : ''}`}
                        >
                            Major
                        </button>
                        <button 
                            onClick={() => handleScaleModeChange('Minor')}
                            disabled={isModeLocked}
                            className={`relative w-1/2 rounded-md py-2 text-sm font-bold transition-colors duration-300 ${selectedKey.scale === 'Minor' ? 'text-gray-900' : 'text-gray-300 hover:text-white'} ${isModeLocked ? 'cursor-not-allowed' : ''}`}
                        >
                            Minor
                        </button>
                    </div>
                </div>
                <button
                    onClick={() => onKeyChange(null)}
                    className="w-full max-w-xs p-2 rounded-md text-white font-semibold transition-all duration-200 bg-gray-600 hover:bg-gray-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-blue-500"
                >
                    Clear Key (Manual Mode)
                </button>
              </>
            ) : (
                <p className="w-full max-w-xs p-2 text-center text-gray-400 text-sm h-[76px] flex items-center justify-center">
                    Select a root note from the circle to set the key.
                </p>
            )}
        </div>
      </div>

       <div>
        <h2 className="text-base font-bold mb-2 border-b border-gray-600 pb-1">Note Spelling</h2>
        <div className="relative flex w-full p-1 bg-gray-700 rounded-lg">
            <div 
                className="absolute top-1 left-1 h-[calc(100%-8px)] w-[calc(33.33%-5px)] bg-stone-200 rounded-md transition-transform duration-300 ease-in-out"
                style={{ transform: `translateX(${enharmonicMode === 'auto' ? '0%' : enharmonicMode === 'sharp' ? '100%' : '200%'})` }}
            ></div>
            <button onClick={() => onEnharmonicModeChange('auto')} className={`relative w-1/3 rounded-md py-2 text-sm font-bold transition-colors duration-300 ${enharmonicMode === 'auto' ? 'text-gray-900' : 'text-gray-300 hover:text-white'}`}>Auto</button>
            <button onClick={() => onEnharmonicModeChange('sharp')} className={`relative w-1/3 rounded-md py-2 text-2xl font-bold transition-colors duration-300 ${enharmonicMode === 'sharp' ? 'text-gray-900' : 'text-gray-300 hover:text-white'}`}>♯</button>
            <button onClick={() => onEnharmonicModeChange('flat')} className={`relative w-1/3 rounded-md py-2 text-2xl font-bold transition-colors duration-300 ${enharmonicMode === 'flat' ? 'text-gray-900' : 'text-gray-300 hover:text-white'}`}>♭</button>
        </div>
      </div>
    </div>
  );
};

export default Controls;